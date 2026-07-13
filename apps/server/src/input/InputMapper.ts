/**
 * InputMapper — shared ingress logic that turns an incoming signal (OSC, TCP, or
 * HTTP) into a system action, using the rules stored in `input_mappings` and the
 * `trigger_actions` wired to them.
 *
 * It is deliberately transport-agnostic: an ingress server (the OSC/TCP servers)
 * only has to parse its wire format into a neutral {@link InputSignal}
 * (`{ protocol, address, args }`) and call `handle(signal)`. All the matching and
 * dispatch live here once, so every protocol behaves identically.
 *
 * Responsibilities (PLAN.md §4.1):
 *   1. Pattern matching — exact (`/scene/execute`) and parameterised
 *      (`/dim/:level`, capturing the segment as a path param).
 *   2. An in-memory cache of the *enabled* mappings, grouped by protocol, each
 *      joined with its `trigger_actions` (0..N — a mapping with none matched but
 *      fires nothing, which is a normal, valid state before it's wired up on the
 *      canvas). `reload()` is called by the mappings AND trigger-actions CRUD so
 *      edits take effect immediately.
 *   3. Dispatch — hand every matched mapping's actions to the shared
 *      {@link TriggerActionDispatcher}, which resolves each action's `params`
 *      template against the signal's args/path params and runs it.
 *
 * The cache is the only state; matching is otherwise pure (and exposed via
 * {@link match} for the `/mappings/test` dry-run, which never dispatches).
 */

import type { InputMapping, TriggerAction } from "@gallery/types";
import type { TemplateContext, TriggerDispatchOutcome } from "../core/TriggerActionDispatcher.ts";
import type { Logger } from "../logger.ts";
import { compilePattern, matchPattern, type CompiledPattern } from "./patterns.ts";

/** A normalized incoming signal, produced by each ingress transport. */
export interface InputSignal {
  /** "osc" | "tcp" | "http" — only mappings on this protocol are considered. */
  protocol: string;
  /** The address/path to match against patterns (OSC address, TCP command path). */
  address: string;
  /** Positional arguments referenced by `{arg[N]}` templates. */
  args?: unknown[];
}

/** A mapping that matched a signal. */
export interface MappingMatch {
  mapping: InputMapping;
  /** Segments captured by `:name` pattern params (always strings). */
  pathParams: Record<string, string>;
}

/** A match plus the trigger actions cached for it — the shape {@link handle} dispatches. */
interface CompiledMatch extends MappingMatch {
  actions: TriggerAction[];
}

// ── injected dependency contracts (narrow, for hermetic tests) ─

/** Source of the enabled mappings the cache is built from. */
export interface InputMappingSource {
  listEnabled(): Promise<InputMapping[]>;
}

/** Source of the trigger actions wired to a set of mappings. */
export interface TriggerActionSource {
  listByMappingIds(mappingIds: string[]): Promise<TriggerAction[]>;
}

/** The shared dispatcher every trigger source (schedules, mappings, …) fires through. */
export interface MapperDispatcher {
  dispatchAll(
    actions: readonly TriggerAction[],
    source: string,
    sourceDetail: string,
    template?: TemplateContext,
  ): Promise<TriggerDispatchOutcome[]>;
}

export interface InputMapperOptions {
  repo: InputMappingSource;
  triggerActions: TriggerActionSource;
  dispatcher: MapperDispatcher;
  logger: Logger;
}

/** A cache entry: the row plus its pre-compiled pattern and wired trigger actions. */
interface CompiledMapping {
  mapping: InputMapping;
  pattern: CompiledPattern;
  actions: TriggerAction[];
}

export class InputMapper {
  private readonly log: Logger;
  /** Enabled mappings, grouped by protocol; rebuilt by {@link reload}. */
  private cache = new Map<string, CompiledMapping[]>();

  constructor(private readonly opts: InputMapperOptions) {
    this.log = opts.logger.child("input_mapper");
  }

  /**
   * Load the enabled mappings (and their trigger actions) into the cache. Called
   * on start, and after mappings OR trigger-actions CRUD.
   */
  async reload(): Promise<void> {
    const rows = await this.opts.repo.listEnabled();
    const actionsByMapping = await this.loadActionsByMapping(rows.map((r) => r.id));

    const next = new Map<string, CompiledMapping[]>();
    for (const mapping of rows) {
      const bucket = next.get(mapping.protocol) ?? [];
      bucket.push({
        mapping,
        pattern: compilePattern(mapping.pattern),
        actions: actionsByMapping.get(mapping.id) ?? [],
      });
      next.set(mapping.protocol, bucket);
    }
    this.cache = next;
    this.log.info("mappings reloaded", { count: rows.length, protocols: [...next.keys()] });
  }

  /** Build the initial cache. */
  async start(): Promise<void> {
    await this.reload();
  }

  /** How many enabled mappings are cached (across all protocols). */
  size(): number {
    let n = 0;
    for (const bucket of this.cache.values()) n += bucket.length;
    return n;
  }

  /**
   * Match a signal against the cached rules for its protocol. Pure (no
   * dispatch) — used both by {@link handle} and the `/mappings/test` dry-run.
   *
   * @returns Every matching mapping with its captured path params, in cache order.
   */
  match(signal: InputSignal): MappingMatch[] {
    return this.matchCompiled(signal).map(({ mapping, pathParams }) => ({ mapping, pathParams }));
  }

  /**
   * Match a signal and dispatch every wired trigger action of every matching
   * rule. The transport calls this after emitting its `input.{protocol}.received`
   * event.
   *
   * @returns One outcome per dispatched trigger action (empty if nothing matched
   * or every match is still unwired).
   */
  async handle(signal: InputSignal): Promise<TriggerDispatchOutcome[]> {
    const matches = this.matchCompiled(signal);
    if (matches.length === 0) {
      this.log.debug("no mapping matched", { protocol: signal.protocol, address: signal.address });
      return [];
    }

    const args = signal.args ?? [];
    const sourceDetail = `${signal.protocol}:${signal.address}`;
    const outcomes: TriggerDispatchOutcome[] = [];
    for (const m of matches) {
      if (m.actions.length === 0) {
        this.log.debug("mapping matched but has no wired trigger actions", { mapping: m.mapping.name });
        continue;
      }
      const template: TemplateContext = { args, pathParams: m.pathParams };
      const results = await this.opts.dispatcher.dispatchAll(m.actions, signal.protocol, sourceDetail, template);
      outcomes.push(...results);
    }
    return outcomes;
  }

  /** Match against the cache, keeping each mapping's wired trigger actions. */
  private matchCompiled(signal: InputSignal): CompiledMatch[] {
    const bucket = this.cache.get(signal.protocol) ?? [];
    const out: CompiledMatch[] = [];
    for (const { mapping, pattern, actions } of bucket) {
      const pathParams = matchPattern(pattern, signal.address);
      if (pathParams === null) continue;
      out.push({ mapping, pathParams, actions });
    }
    return out;
  }

  /** Group the trigger actions of a set of mappings by their `mappingId`. */
  private async loadActionsByMapping(mappingIds: string[]): Promise<Map<string, TriggerAction[]>> {
    const byMapping = new Map<string, TriggerAction[]>();
    if (mappingIds.length === 0) return byMapping;
    const actions = await this.opts.triggerActions.listByMappingIds(mappingIds);
    for (const action of actions) {
      if (!action.mappingId) continue;
      const bucket = byMapping.get(action.mappingId) ?? [];
      bucket.push(action);
      byMapping.set(action.mappingId, bucket);
    }
    return byMapping;
  }
}

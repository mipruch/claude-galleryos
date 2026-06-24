/**
 * InputMapper — shared ingress logic that turns an incoming signal (OSC, TCP, or
 * HTTP) into a system action, using the rules stored in `input_mappings`.
 *
 * It is deliberately transport-agnostic: an ingress server (the upcoming
 * `TcpInputServer` / OSC server) only has to parse its wire format into a neutral
 * {@link InputSignal} (`{ protocol, address, args }`) and call `handle(signal)`.
 * All the matching, parameter templating, and dispatch live here once, so every
 * protocol behaves identically.
 *
 * Responsibilities (PLAN.md §4.1):
 *   1. Pattern matching — exact (`/scene/execute`) and parameterised
 *      (`/dim/:level`, capturing the segment as a path param).
 *   2. Template evaluation — fill a mapping's `paramsTemplate` from the signal:
 *      `{arg[0]}` (positional arg), `{:level}` (captured path param), or a literal.
 *   3. An in-memory cache of the *enabled* mappings, grouped by protocol, with
 *      `reload()` called by the mappings CRUD so edits take effect immediately.
 *   4. Dispatch — route a matched rule to the SceneEngine / DeviceManager /
 *      EventBus.
 *
 * The cache is the only state; matching and templating are otherwise pure (and
 * exposed via {@link match} for the `/mappings/test` dry-run, which never
 * dispatches).
 */

import type { CommandResult } from "@gallery/driver-core";
import { errMsg } from "@gallery/driver-core";
import type { InputMapping, InputTargetType } from "@gallery/types";
import type { EventBus } from "../core/EventBus.ts";
import type { Logger } from "../logger.ts";
import { compilePattern, evaluateTemplate, matchPattern, type CompiledPattern } from "./patterns.ts";

/** A normalized incoming signal, produced by each ingress transport. */
export interface InputSignal {
  /** "osc" | "tcp" | "http" — only mappings on this protocol are considered. */
  protocol: string;
  /** The address/path to match against patterns (OSC address, TCP command path). */
  address: string;
  /** Positional arguments referenced by `{arg[N]}` templates. */
  args?: unknown[];
}

/** A mapping that matched a signal, with its evaluated action parameters. */
export interface MappingMatch {
  mapping: InputMapping;
  /** Segments captured by `:name` pattern params (always strings). */
  pathParams: Record<string, string>;
  /** `paramsTemplate` after substitution — what the action runs with. */
  params: Record<string, unknown>;
}

/** Outcome of dispatching a single matched mapping. */
export interface DispatchOutcome {
  mappingId: string;
  targetType: InputTargetType;
  ok: boolean;
  detail?: string;
}

// ── injected dependency contracts (narrow, for hermetic tests) ─

/** Source of the enabled mappings the cache is built from. */
export interface InputMappingSource {
  listEnabled(): Promise<InputMapping[]>;
}

export interface MapperSceneEngine {
  startScene(
    sceneId: string,
    source: string,
    opts?: { sourceDetail?: string },
  ): Promise<{ executionId: string; sceneId: string; status: string }>;
}

export interface MapperDeviceManager {
  execute(deviceId: string, command: string, params: Record<string, unknown>): Promise<CommandResult>;
}

export interface InputMapperOptions {
  repo: InputMappingSource;
  logger: Logger;
  /** Dispatch sinks. Optional so the `/test` route can build a match-only mapper. */
  sceneEngine?: MapperSceneEngine;
  deviceManager?: MapperDeviceManager;
  eventBus?: EventBus;
}

/** A cache entry: the row plus its pre-compiled pattern. */
interface CompiledMapping {
  mapping: InputMapping;
  pattern: CompiledPattern;
}

export class InputMapper {
  private readonly log: Logger;
  /** Enabled mappings, grouped by protocol; rebuilt by {@link reload}. */
  private cache = new Map<string, CompiledMapping[]>();

  constructor(private readonly opts: InputMapperOptions) {
    this.log = opts.logger.child("input_mapper");
  }

  /** Load the enabled mappings into the cache. Called on start and after CRUD. */
  async reload(): Promise<void> {
    const rows = await this.opts.repo.listEnabled();
    const next = new Map<string, CompiledMapping[]>();
    for (const mapping of rows) {
      const bucket = next.get(mapping.protocol) ?? [];
      bucket.push({ mapping, pattern: compilePattern(mapping.pattern) });
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
   * @returns Every matching mapping with its evaluated params, in cache order.
   */
  match(signal: InputSignal): MappingMatch[] {
    const bucket = this.cache.get(signal.protocol) ?? [];
    const args = signal.args ?? [];
    const out: MappingMatch[] = [];
    for (const { mapping, pattern } of bucket) {
      const pathParams = matchPattern(pattern, signal.address);
      if (pathParams === null) continue;
      out.push({
        mapping,
        pathParams,
        params: evaluateTemplate(mapping.paramsTemplate, args, pathParams),
      });
    }
    return out;
  }

  /**
   * Match a signal and dispatch every matching rule. The transport calls this
   * after emitting its `input.{protocol}.received` event.
   *
   * @returns One outcome per matched mapping (empty if nothing matched).
   */
  async handle(signal: InputSignal): Promise<DispatchOutcome[]> {
    const matches = this.match(signal);
    if (matches.length === 0) {
      this.log.debug("no mapping matched", { protocol: signal.protocol, address: signal.address });
      return [];
    }
    const outcomes: DispatchOutcome[] = [];
    for (const m of matches) outcomes.push(await this.dispatch(m, signal));
    return outcomes;
  }

  /** Execute a single matched mapping against its target sink. */
  async dispatch(m: MappingMatch, signal: InputSignal): Promise<DispatchOutcome> {
    const { mapping, params } = m;
    const sourceDetail = `${signal.protocol}:${signal.address}`;
    const base = { mappingId: mapping.id, targetType: mapping.targetType };
    try {
      switch (mapping.targetType) {
        case "scene.execute": {
          if (!mapping.targetId) throw new Error("scene.execute mapping has no targetId");
          if (!this.opts.sceneEngine) throw new Error("no SceneEngine wired");
          const r = await this.opts.sceneEngine.startScene(mapping.targetId, signal.protocol, {
            sourceDetail,
          });
          this.log.info("mapping ran scene", { mapping: mapping.name, sceneId: mapping.targetId });
          return { ...base, ok: true, detail: `execution ${r.executionId}` };
        }
        case "device.command": {
          if (!mapping.targetId || !mapping.targetCommand) {
            throw new Error("device.command mapping needs targetId and targetCommand");
          }
          if (!this.opts.deviceManager) throw new Error("no DeviceManager wired");
          const res = await this.opts.deviceManager.execute(
            mapping.targetId,
            mapping.targetCommand,
            params,
          );
          this.log[res.success ? "info" : "warn"]("mapping ran command", {
            mapping: mapping.name,
            deviceId: mapping.targetId,
            command: mapping.targetCommand,
            success: res.success,
          });
          return { ...base, ok: res.success, detail: res.error };
        }
        case "event.emit": {
          // A closed, typed bus has no arbitrary events; surface a named hook
          // others (or future automations) can listen for.
          this.opts.eventBus?.emit({
            type: "input.mapping.triggered",
            mappingId: mapping.id,
            name: mapping.name,
            params,
          });
          this.log.info("mapping emitted event", { mapping: mapping.name });
          return { ...base, ok: true };
        }
        default: {
          // Exhaustive: a new target type is a compile error here.
          const never: never = mapping.targetType;
          throw new Error(`unknown target type: ${String(never)}`);
        }
      }
    } catch (err) {
      this.log.warn("mapping dispatch failed", { mapping: mapping.name, error: errMsg(err) });
      return { ...base, ok: false, detail: errMsg(err) };
    }
  }
}

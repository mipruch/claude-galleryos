/**
 * SceneEngine — executes a scene's actions against devices.
 *
 * A scene is an ordered set of actions grouped into `parallelGroup`s. Groups run
 * sequentially in ascending order; actions within a group run concurrently. Each
 * action may carry a `delayMs` (applied before it runs) and an `onFailure` mode:
 *   - "continue" (default): a failed action is logged; the scene proceeds.
 *   - "abort": a failed action stops the remaining groups and fails the scene.
 *
 * Simplifications (see PLAN.md §2): no versioning, no pre-state capture, no
 * rollback, no crash recovery. A scene already running is rejected (409).
 *
 * Dependencies are injected via narrow interfaces so the engine is testable with
 * fakes — no DB, Redis, or driver subprocess needed. The composition root wires
 * the real repositories, Redis scene store, DeviceManager, and EventBus.
 *
 * Two entry points:
 *   - `executeScene(...)` runs to completion and resolves with the outcome
 *     (used by the REST controller, the scheduler, and tests).
 *   - `start()` subscribes to `scene.execute.requested` on the EventBus so the
 *     WebSocket layer can trigger a run by emitting that event.
 */

import type { CommandResult } from "@gallery/driver-core";
import type { EventBus } from "./EventBus.ts";
import type { Logger } from "../logger.ts";

// ── scene shapes the engine consumes (decoupled from Drizzle) ─

export interface SceneActionRecord {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  stepOrder: number;
  parallelGroup: number;
  delayMs: number;
  /** "continue" | "abort" */
  onFailure: string;
}

export interface SceneRecord {
  id: string;
  name: string;
  actions: SceneActionRecord[];
}

// ── injected dependency contracts ─────────────────────────────

export interface SceneRepoLike {
  get(id: string): Promise<SceneRecord | undefined>;
}

export interface SceneExecutionRow {
  id: string;
}

export interface SceneExecutionsRepoLike {
  create(data: {
    id?: string;
    sceneId: string;
    source: string;
    sourceDetail?: string;
  }): Promise<SceneExecutionRow | undefined>;
  updateStatus(id: string, status: string, durationMs?: number, errorMessage?: string): Promise<unknown>;
  getRunning(sceneId: string): Promise<unknown | undefined>;
}

export interface SceneStateStore {
  setSceneActive(sceneId: string): Promise<void>;
  clearSceneActive(sceneId: string): Promise<void>;
  isSceneActive(sceneId: string): Promise<boolean>;
}

export interface SceneDeviceManager {
  execute(deviceId: string, command: string, params: Record<string, unknown>): Promise<CommandResult>;
}

/** Used by pre-flight to verify each referenced device exists. */
export interface SceneDeviceLookup {
  get(deviceId: string): Promise<unknown | undefined>;
}

export interface SceneEngineOptions {
  scenes: SceneRepoLike;
  executions: SceneExecutionsRepoLike;
  state: SceneStateStore;
  deviceManager: SceneDeviceManager;
  devices: SceneDeviceLookup;
  eventBus: EventBus;
  logger: Logger;
}

// ── typed errors (mapped to HTTP codes by the route) ──────────

export class SceneNotFoundError extends Error {
  constructor(sceneId: string) {
    super(`scene not found: ${sceneId}`);
  }
}
export class SceneConflictError extends Error {
  constructor(sceneId: string) {
    super(`scene already running: ${sceneId}`);
  }
}
export class SceneValidationError extends Error {}

// ── results ───────────────────────────────────────────────────

export interface SceneExecutionResult {
  executionId: string;
  sceneId: string;
  status: "completed" | "failed";
  durationMs: number;
  /** Number of actions that failed (across all groups). */
  failedActions: number;
  error?: string;
}

export interface DryRunStep {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  parallelGroup: number;
  delayMs: number;
  onFailure: string;
}
export interface DryRunResult {
  sceneId: string;
  dryRun: true;
  groups: number;
  actions: DryRunStep[];
}

interface ActionOutcome {
  success: boolean;
  onFailure: string;
  deviceId: string;
  command: string;
  error?: string;
}

// ── engine ─────────────────────────────────────────────────────

export class SceneEngine {
  private readonly log: Logger;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: SceneEngineOptions) {
    this.log = opts.logger.child("scene_engine");
  }

  /** Subscribe to `scene.execute.requested` (used by the WebSocket trigger). */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.opts.eventBus.on("scene.execute.requested", (e) => {
      void this.executeScene(e.sceneId, e.source, { executionId: e.executionId }).catch((err) => {
        // Failures already surfaced as scene.execute.failed; just trace here.
        this.log.debug("requested scene run ended with error", {
          sceneId: e.sceneId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
    this.log.info("SceneEngine started");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Run a scene to completion. Throws {@link SceneNotFoundError},
   * {@link SceneConflictError}, or {@link SceneValidationError} during pre-flight
   * (before any execution row is created). Once running, failures are reported
   * via the returned result and the `scene.execute.failed` event rather than throws.
   */
  async executeScene(
    sceneId: string,
    source: string,
    opts: { executionId?: string; sourceDetail?: string } = {},
  ): Promise<SceneExecutionResult> {
    const { scene, executionId } = await this.beginRun(sceneId, source, opts);
    return this.runPlan(scene, executionId);
  }

  /**
   * Fire-and-return variant for the REST controller: completes pre-flight (so
   * conflicts/validation surface synchronously as throws), then runs the plan in
   * the background and returns the executionId immediately with status "running".
   */
  async startScene(
    sceneId: string,
    source: string,
    opts: { executionId?: string; sourceDetail?: string } = {},
  ): Promise<{ executionId: string; sceneId: string; status: "running" }> {
    const { scene, executionId } = await this.beginRun(sceneId, source, opts);
    void this.runPlan(scene, executionId).catch((err) => {
      this.log.warn("background scene run errored", {
        sceneId,
        executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { executionId, sceneId, status: "running" };
  }

  /**
   * Shared pre-flight + claim + execution-row + started-event. Throws the typed
   * pre-flight errors before any side effects beyond the (released-on-failure) lock.
   */
  private async beginRun(
    sceneId: string,
    source: string,
    opts: { executionId?: string; sourceDetail?: string },
  ): Promise<{ scene: SceneRecord; executionId: string }> {
    const scene = await this.preflight(sceneId);

    // Claim the scene (reject if already active).
    if (await this.opts.state.isSceneActive(sceneId)) throw new SceneConflictError(sceneId);
    await this.opts.state.setSceneActive(sceneId);

    let executionId = opts.executionId ?? crypto.randomUUID();
    try {
      const row = await this.opts.executions.create({
        id: opts.executionId,
        sceneId,
        source,
        sourceDetail: opts.sourceDetail,
      });
      if (row?.id) executionId = row.id;
    } catch (err) {
      // If we can't record the run, release the lock and abort cleanly.
      await this.opts.state.clearSceneActive(sceneId);
      throw err;
    }

    this.opts.eventBus.emit({ type: "scene.execute.started", sceneId, executionId });
    this.log.info("scene started", { sceneId, executionId, source, actions: scene.actions.length });
    return { scene, executionId };
  }

  /**
   * Simulate a scene without touching hardware: validates the scene + devices and
   * returns the planned actions in execution order. No DB write, no lock, no events.
   */
  async dryRun(sceneId: string): Promise<DryRunResult> {
    const scene = await this.preflight(sceneId);
    const groups = planGroups(scene.actions);
    const actions: DryRunStep[] = groups.flat().map((a) => ({
      deviceId: a.deviceId,
      command: a.command,
      params: a.params,
      parallelGroup: a.parallelGroup,
      delayMs: a.delayMs,
      onFailure: a.onFailure,
    }));
    this.log.info("scene dry-run", { sceneId, groups: groups.length, actions: actions.length });
    return { sceneId, dryRun: true, groups: groups.length, actions };
  }

  // ── internals ──────────────────────────────────────────────

  /** Load the scene and verify every referenced device exists. */
  private async preflight(sceneId: string): Promise<SceneRecord> {
    const scene = await this.opts.scenes.get(sceneId);
    if (!scene) throw new SceneNotFoundError(sceneId);

    const deviceIds = [...new Set(scene.actions.map((a) => a.deviceId))];
    const checks = await Promise.all(deviceIds.map((id) => this.opts.devices.get(id)));
    const missing = deviceIds.filter((_, i) => !checks[i]);
    if (missing.length) {
      throw new SceneValidationError(`scene references unknown device(s): ${missing.join(", ")}`);
    }
    return scene;
  }

  /** Run the grouped plan, then record completion + clear the lock. */
  private async runPlan(scene: SceneRecord, executionId: string): Promise<SceneExecutionResult> {
    const start = Date.now();
    const groups = planGroups(scene.actions);

    let aborted = false;
    let abortError: string | undefined;
    let failedActions = 0;

    try {
      for (const group of groups) {
        const outcomes = await Promise.all(group.map((a) => this.runAction(a, executionId)));
        for (const o of outcomes) {
          if (o.success) continue;
          failedActions++;
          if (o.onFailure === "abort") {
            aborted = true;
            abortError ??= `action ${o.command} on ${o.deviceId} failed: ${o.error ?? "unknown"} (on_failure=abort)`;
          }
        }
        if (aborted) break;
      }
    } catch (err) {
      // Unexpected engine error (not a normal action failure).
      aborted = true;
      abortError = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - start;
    await this.opts.state.clearSceneActive(scene.id);

    if (aborted) {
      const error = abortError ?? "scene aborted";
      await this.safeUpdateStatus(executionId, "failed", durationMs, error);
      this.opts.eventBus.emit({ type: "scene.execute.failed", sceneId: scene.id, executionId, error });
      this.log.warn("scene failed", { sceneId: scene.id, executionId, error, durationMs });
      return { executionId, sceneId: scene.id, status: "failed", durationMs, failedActions, error };
    }

    await this.safeUpdateStatus(executionId, "completed", durationMs);
    this.opts.eventBus.emit({ type: "scene.execute.completed", sceneId: scene.id, executionId, durationMs });
    this.log.info("scene completed", { sceneId: scene.id, executionId, durationMs, failedActions });
    return { executionId, sceneId: scene.id, status: "completed", durationMs, failedActions };
  }

  /** Execute one action: honour delay, call the device, classify the result. */
  private async runAction(action: SceneActionRecord, executionId: string): Promise<ActionOutcome> {
    const { deviceId, command, params, delayMs, onFailure } = action;
    if (delayMs > 0) await Bun.sleep(delayMs);
    try {
      const result = await this.opts.deviceManager.execute(deviceId, command, params);
      if (!result.success) {
        this.log.warn("scene action failed", { executionId, deviceId, command, error: result.error });
        return { success: false, onFailure, deviceId, command, error: result.error };
      }
      return { success: true, onFailure, deviceId, command };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.warn("scene action threw", { executionId, deviceId, command, error });
      return { success: false, onFailure, deviceId, command, error };
    }
  }

  /** Update the execution row without letting a DB hiccup mask the run outcome. */
  private async safeUpdateStatus(
    id: string,
    status: string,
    durationMs?: number,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.opts.executions.updateStatus(id, status, durationMs, errorMessage);
    } catch (err) {
      this.log.warn("failed to update execution status", {
        executionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── pure planner ───────────────────────────────────────────────

/**
 * Group actions by `parallelGroup` and return the groups sorted ascending. Within
 * a group, actions keep their `stepOrder` for deterministic logging.
 */
export function planGroups(actions: SceneActionRecord[]): SceneActionRecord[][] {
  const byGroup = new Map<number, SceneActionRecord[]>();
  for (const a of actions) {
    const list = byGroup.get(a.parallelGroup) ?? [];
    list.push(a);
    byGroup.set(a.parallelGroup, list);
  }
  return [...byGroup.keys()]
    .sort((x, y) => x - y)
    .map((g) => byGroup.get(g)!.sort((a, b) => a.stepOrder - b.stepOrder));
}

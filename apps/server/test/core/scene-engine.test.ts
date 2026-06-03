/**
 * SceneEngine tests — hermetic (no DB / Redis / driver subprocess).
 *
 * All dependencies are cheap in-memory fakes. We assert ordering (groups run
 * sequentially, actions within a group concurrently), on_failure semantics,
 * the active-lock lifecycle, pre-flight errors, dry-run, and the event trigger.
 */

import { describe, expect, test } from "bun:test";
import {
  SceneConflictError,
  SceneEngine,
  SceneNotFoundError,
  SceneValidationError,
  type SceneActionRecord,
  type SceneRecord,
} from "../../src/core/SceneEngine.ts";
import { EventBus, type GalleryEvent } from "../../src/core/EventBus.ts";
import { logger } from "../../src/logger.ts";

// ── fakes ─────────────────────────────────────────────────────

function makeExec() {
  const created: Array<{ id: string; sceneId: string; source: string }> = [];
  const statuses: Array<{ id: string; status: string; durationMs?: number; error?: string }> = [];
  return {
    created,
    statuses,
    async create(data: { id?: string; sceneId: string; source: string }) {
      const id = data.id ?? `exec-${created.length + 1}`;
      created.push({ id, sceneId: data.sceneId, source: data.source });
      return { id };
    },
    async updateStatus(id: string, status: string, durationMs?: number, error?: string) {
      statuses.push({ id, status, durationMs, error });
    },
    async getRunning() {
      return undefined;
    },
  };
}

function makeState() {
  const active = new Set<string>();
  return {
    active,
    async setSceneActive(id: string) {
      active.add(id);
    },
    async clearSceneActive(id: string) {
      active.delete(id);
    },
    async isSceneActive(id: string) {
      return active.has(id);
    },
  };
}

function makeDM() {
  const calls: Array<{ deviceId: string; command: string; at: number }> = [];
  const fail = new Set<string>();
  return {
    calls,
    failOn(deviceId: string, command: string) {
      fail.add(`${deviceId}:${command}`);
    },
    async execute(deviceId: string, command: string, _params: Record<string, unknown>) {
      calls.push({ deviceId, command, at: Date.now() });
      const ok = !fail.has(`${deviceId}:${command}`);
      return { success: ok, durationMs: 1, error: ok ? undefined : "boom" };
    },
  };
}

function makeDevices(ids: string[]) {
  const set = new Set(ids);
  return {
    async get(id: string) {
      return set.has(id) ? { id } : undefined;
    },
  };
}

function action(p: Partial<SceneActionRecord> = {}): SceneActionRecord {
  return {
    deviceId: "d1",
    command: "on",
    params: {},
    stepOrder: 0,
    parallelGroup: 0,
    delayMs: 0,
    onFailure: "continue",
    ...p,
  };
}

function makeEngine(scene: SceneRecord, deviceIdsOverride?: string[]) {
  const executions = makeExec();
  const state = makeState();
  const dm = makeDM();
  const bus = new EventBus();
  const events: GalleryEvent[] = [];
  bus.onAny((e) => events.push(e));
  const deviceIds = deviceIdsOverride ?? [...new Set(scene.actions.map((a) => a.deviceId))];
  const engine = new SceneEngine({
    scenes: { async get(id: string) { return id === scene.id ? scene : undefined; } },
    executions,
    state,
    deviceManager: dm,
    devices: makeDevices(deviceIds),
    eventBus: bus,
    logger,
  });
  return { engine, executions, state, dm, bus, events };
}

const sceneTypes = (events: GalleryEvent[]) =>
  events.filter((e) => e.type.startsWith("scene.")).map((e) => e.type);

// ── tests ─────────────────────────────────────────────────────

describe("SceneEngine — execution", () => {
  test("runs all actions, emits started+completed, manages the active lock", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "All on",
      actions: [action({ deviceId: "d1", command: "on" }), action({ deviceId: "d2", command: "on" })],
    };
    const { engine, executions, state, dm, events } = makeEngine(scene);

    const result = await engine.executeScene("s1", "test");

    expect(result.status).toBe("completed");
    expect(result.failedActions).toBe(0);
    expect(dm.calls.map((c) => c.deviceId).sort()).toEqual(["d1", "d2"]);
    expect(executions.created).toHaveLength(1);
    expect(executions.statuses.at(-1)).toMatchObject({ status: "completed" });
    expect(state.active.has("s1")).toBe(false); // lock released
    expect(sceneTypes(events)).toEqual(["scene.execute.started", "scene.execute.completed"]);
  });

  test("groups run sequentially; actions within a group run concurrently", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "Ordered",
      actions: [
        action({ deviceId: "g0a", parallelGroup: 0, stepOrder: 0 }),
        action({ deviceId: "g0b", parallelGroup: 0, stepOrder: 1 }),
        action({ deviceId: "g1a", parallelGroup: 1, stepOrder: 0 }),
      ],
    };
    const { engine, dm } = makeEngine(scene);
    await engine.executeScene("s1", "test");

    const order = dm.calls.map((c) => c.deviceId);
    // Both group-0 actions must precede the group-1 action.
    expect(order.indexOf("g0a")).toBeLessThan(order.indexOf("g1a"));
    expect(order.indexOf("g0b")).toBeLessThan(order.indexOf("g1a"));
  });

  test("delayMs is honoured before an action runs", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "Delayed",
      actions: [action({ deviceId: "d1", delayMs: 40 })],
    };
    const { engine } = makeEngine(scene);
    const r = await engine.executeScene("s1", "test");
    expect(r.durationMs).toBeGreaterThanOrEqual(35);
  });
});

describe("SceneEngine — on_failure", () => {
  test("'abort' stops remaining groups and fails the scene", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "Abort",
      actions: [
        action({ deviceId: "d1", command: "boom", parallelGroup: 0, onFailure: "abort" }),
        action({ deviceId: "d2", command: "on", parallelGroup: 1 }),
      ],
    };
    const { engine, dm, state, events } = makeEngine(scene);
    dm.failOn("d1", "boom");

    const result = await engine.executeScene("s1", "test");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("on_failure=abort");
    // Group 1 must never run.
    expect(dm.calls.some((c) => c.deviceId === "d2")).toBe(false);
    expect(state.active.has("s1")).toBe(false);
    expect(sceneTypes(events)).toEqual(["scene.execute.started", "scene.execute.failed"]);
  });

  test("'continue' logs the failure but completes the scene", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "Continue",
      actions: [
        action({ deviceId: "d1", command: "boom", parallelGroup: 0, onFailure: "continue" }),
        action({ deviceId: "d2", command: "on", parallelGroup: 1 }),
      ],
    };
    const { engine, dm } = makeEngine(scene);
    dm.failOn("d1", "boom");

    const result = await engine.executeScene("s1", "test");

    expect(result.status).toBe("completed");
    expect(result.failedActions).toBe(1);
    // Group 1 still runs despite the group-0 failure.
    expect(dm.calls.some((c) => c.deviceId === "d2")).toBe(true);
  });
});

describe("SceneEngine — pre-flight", () => {
  test("rejects a scene that is already running (conflict)", async () => {
    const scene: SceneRecord = { id: "s1", name: "X", actions: [action()] };
    const { engine, state, executions } = makeEngine(scene);
    state.active.add("s1"); // already running

    await expect(engine.executeScene("s1", "test")).rejects.toBeInstanceOf(SceneConflictError);
    expect(executions.created).toHaveLength(0); // no run recorded
  });

  test("throws SceneNotFoundError for an unknown scene", async () => {
    const scene: SceneRecord = { id: "s1", name: "X", actions: [action()] };
    const { engine } = makeEngine(scene);
    await expect(engine.executeScene("nope", "test")).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  test("throws SceneValidationError when an action references a missing device", async () => {
    const scene: SceneRecord = { id: "s1", name: "X", actions: [action({ deviceId: "ghost" })] };
    const { engine, state } = makeEngine(scene, []); // no devices exist
    await expect(engine.executeScene("s1", "test")).rejects.toBeInstanceOf(SceneValidationError);
    expect(state.active.has("s1")).toBe(false); // never claimed
  });
});

describe("SceneEngine — dry-run", () => {
  test("returns the plan without touching devices, lock, or DB", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "Preview",
      actions: [
        action({ deviceId: "d2", parallelGroup: 1 }),
        action({ deviceId: "d1", parallelGroup: 0 }),
      ],
    };
    const { engine, dm, state, executions } = makeEngine(scene);

    const result = await engine.dryRun("s1");

    expect(result.dryRun).toBe(true);
    expect(result.groups).toBe(2);
    // Plan is ordered by group: d1 (group 0) before d2 (group 1).
    expect(result.actions.map((a) => a.deviceId)).toEqual(["d1", "d2"]);
    expect(dm.calls).toHaveLength(0);
    expect(state.active.size).toBe(0);
    expect(executions.created).toHaveLength(0);
  });

  test("dry-run still validates the scene exists", async () => {
    const scene: SceneRecord = { id: "s1", name: "X", actions: [action()] };
    const { engine } = makeEngine(scene);
    await expect(engine.dryRun("nope")).rejects.toBeInstanceOf(SceneNotFoundError);
  });
});

describe("SceneEngine — startScene (background)", () => {
  test("returns running immediately, then completes in the background", async () => {
    const scene: SceneRecord = {
      id: "s1",
      name: "BG",
      actions: [action({ deviceId: "d1", delayMs: 30 })],
    };
    const { engine, bus, dm } = makeEngine(scene);

    const done = new Promise<GalleryEvent>((resolve) => bus.once("scene.execute.completed", resolve));
    const ack = await engine.startScene("s1", "rest");

    expect(ack.status).toBe("running");
    expect(ack.executionId).toBeTruthy();
    expect(dm.calls).toHaveLength(0); // not run yet (delayed)

    await done;
    expect(dm.calls.some((c) => c.deviceId === "d1")).toBe(true);
  });

  test("startScene rejects a conflicting run synchronously", async () => {
    const scene: SceneRecord = { id: "s1", name: "X", actions: [action()] };
    const { engine, state } = makeEngine(scene);
    state.active.add("s1");
    await expect(engine.startScene("s1", "rest")).rejects.toBeInstanceOf(SceneConflictError);
  });
});

describe("SceneEngine — event trigger", () => {
  test("start() runs a scene when scene.execute.requested is emitted", async () => {
    const scene: SceneRecord = { id: "s1", name: "Triggered", actions: [action({ deviceId: "d1" })] };
    const { engine, bus, dm } = makeEngine(scene);
    engine.start();

    const done = new Promise<GalleryEvent>((resolve) => bus.once("scene.execute.completed", resolve));
    bus.emit({ type: "scene.execute.requested", sceneId: "s1", source: "ws", executionId: "ws-exec-1" });
    const ev = (await done) as Extract<GalleryEvent, { type: "scene.execute.completed" }>;

    expect(ev.executionId).toBe("ws-exec-1"); // engine reused the supplied id
    expect(dm.calls.some((c) => c.deviceId === "d1")).toBe(true);
    engine.stop();
  });
});

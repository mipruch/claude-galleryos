/**
 * TriggerActionDispatcher tests — hermetic, with fake SceneEngine/DeviceManager.
 * Covers both dispatch targets, literal vs. templated params, graceful handling
 * of an unwired action (no targetId) or a targetCommand-less device.command, and
 * that a downstream rejection never throws (surfaces as ok:false instead).
 */

import { describe, expect, test } from "bun:test";
import type { CommandResult } from "@gallery/driver-core";
import type { TriggerAction } from "@gallery/types";
import {
  TriggerActionDispatcher,
  type DispatcherDeviceManager,
  type DispatcherSceneEngine,
} from "../../src/core/TriggerActionDispatcher.ts";
import { logger } from "../../src/logger.ts";

/** Build a TriggerAction row with sensible defaults. */
function action(partial: Partial<TriggerAction> = {}): TriggerAction {
  return {
    id: partial.id ?? crypto.randomUUID(),
    scheduleId: partial.scheduleId ?? null,
    mappingId: partial.mappingId ?? null,
    targetType: partial.targetType ?? "scene.execute",
    targetId: partial.targetId ?? null,
    targetCommand: partial.targetCommand ?? null,
    params: partial.params ?? {},
    position: partial.position ?? null,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
  };
}

function fakeSceneEngine(behavior?: (sceneId: string) => Promise<{ executionId: string; sceneId: string; status: string }>) {
  const calls: Array<{ sceneId: string; source: string; sourceDetail?: string }> = [];
  const engine: DispatcherSceneEngine = {
    async startScene(sceneId, source, opts) {
      calls.push({ sceneId, source, sourceDetail: opts?.sourceDetail });
      if (behavior) return behavior(sceneId);
      return { executionId: "exec-1", sceneId, status: "running" };
    },
  };
  return { engine, calls };
}

function fakeDeviceManager(result: Partial<CommandResult> = {}) {
  const calls: Array<{ deviceId: string; command: string; params: Record<string, unknown> }> = [];
  const dm: DispatcherDeviceManager = {
    async execute(deviceId, command, params) {
      calls.push({ deviceId, command, params });
      return { success: true, durationMs: 1, ...result };
    },
  };
  return { dm, calls };
}

function makeDispatcher(opts: { sceneEngine?: DispatcherSceneEngine; deviceManager?: DispatcherDeviceManager } = {}) {
  const { engine } = fakeSceneEngine();
  const { dm } = fakeDeviceManager();
  return new TriggerActionDispatcher({
    sceneEngine: opts.sceneEngine ?? engine,
    deviceManager: opts.deviceManager ?? dm,
    logger,
  });
}

describe("TriggerActionDispatcher — scene.execute", () => {
  test("runs the scene with the given source and sourceDetail", async () => {
    const { engine, calls } = fakeSceneEngine();
    const dispatcher = makeDispatcher({ sceneEngine: engine });
    const outcome = await dispatcher.dispatch(action({ targetType: "scene.execute", targetId: "s1" }), "scheduler", "scheduler:j1");

    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toBe("execution exec-1");
    expect(calls).toEqual([{ sceneId: "s1", source: "scheduler", sourceDetail: "scheduler:j1" }]);
  });

  test("a rejected startScene surfaces ok:false instead of throwing", async () => {
    const { engine } = fakeSceneEngine(() => Promise.reject(new Error("scene locked")));
    const dispatcher = makeDispatcher({ sceneEngine: engine });
    const outcome = await dispatcher.dispatch(action({ targetType: "scene.execute", targetId: "s1" }), "scheduler", "scheduler:j1");

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("scene locked");
  });
});

describe("TriggerActionDispatcher — device.command", () => {
  test("dispatches literal params when no template context is given", async () => {
    const { dm, calls } = fakeDeviceManager();
    const dispatcher = makeDispatcher({ deviceManager: dm });
    const outcome = await dispatcher.dispatch(
      action({ targetType: "device.command", targetId: "d1", targetCommand: "setLevel", params: { level: 0.5 } }),
      "scheduler",
      "scheduler:j1",
    );

    expect(outcome.ok).toBe(true);
    expect(calls).toEqual([{ deviceId: "d1", command: "setLevel", params: { level: 0.5 } }]);
  });

  test("evaluates the params template against the given signal context", async () => {
    const { dm, calls } = fakeDeviceManager();
    const dispatcher = makeDispatcher({ deviceManager: dm });
    await dispatcher.dispatch(
      action({ targetType: "device.command", targetId: "d1", targetCommand: "setLevel", params: { level: "{:level}" } }),
      "osc",
      "osc:/dim/0.75",
      { args: [], pathParams: { level: "0.75" } },
    );

    expect(calls).toEqual([{ deviceId: "d1", command: "setLevel", params: { level: 0.75 } }]);
  });

  test("a targetId with no targetCommand fails gracefully (no throw, no dispatch)", async () => {
    const { dm, calls } = fakeDeviceManager();
    const dispatcher = makeDispatcher({ deviceManager: dm });
    const outcome = await dispatcher.dispatch(
      action({ targetType: "device.command", targetId: "d1", targetCommand: null }),
      "scheduler",
      "scheduler:j1",
    );

    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a failed device command surfaces ok:false with the driver's error", async () => {
    const { dm } = fakeDeviceManager({ success: false, error: "offline" });
    const dispatcher = makeDispatcher({ deviceManager: dm });
    const outcome = await dispatcher.dispatch(
      action({ targetType: "device.command", targetId: "d1", targetCommand: "on" }),
      "scheduler",
      "scheduler:j1",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("offline");
  });
});

describe("TriggerActionDispatcher — unwired actions", () => {
  test("an action with no targetId is skipped without dispatching", async () => {
    const { engine, calls: sceneCalls } = fakeSceneEngine();
    const { dm, calls: deviceCalls } = fakeDeviceManager();
    const dispatcher = makeDispatcher({ sceneEngine: engine, deviceManager: dm });
    const outcome = await dispatcher.dispatch(action({ targetType: "scene.execute", targetId: null }), "scheduler", "scheduler:j1");

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("not wired to a target");
    expect(sceneCalls).toHaveLength(0);
    expect(deviceCalls).toHaveLength(0);
  });
});

describe("TriggerActionDispatcher — dispatchAll", () => {
  test("dispatches every action in order and returns one outcome each", async () => {
    const { engine } = fakeSceneEngine();
    const { dm } = fakeDeviceManager();
    const dispatcher = makeDispatcher({ sceneEngine: engine, deviceManager: dm });
    const actions = [
      action({ id: "a1", targetType: "scene.execute", targetId: "s1" }),
      action({ id: "a2", targetType: "device.command", targetId: "d1", targetCommand: "on" }),
      action({ id: "a3", targetType: "scene.execute", targetId: null }), // unwired
    ];

    const outcomes = await dispatcher.dispatchAll(actions, "scheduler", "scheduler:j1");

    expect(outcomes.map((o) => o.triggerActionId)).toEqual(["a1", "a2", "a3"]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, true, false]);
  });
});

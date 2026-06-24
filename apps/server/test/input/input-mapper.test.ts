/**
 * InputMapper tests — hermetic, with fake repo/sceneEngine/deviceManager and a
 * real EventBus. Covers cache reload, protocol-scoped matching, the three
 * dispatch targets (scene.execute / device.command / event.emit), templated
 * params reaching the device, and graceful failure when a rule is malformed.
 */

import { describe, expect, test } from "bun:test";
import type { CommandResult } from "@gallery/driver-core";
import type { InputMapping } from "@gallery/types";
import { EventBus } from "../../src/core/EventBus.ts";
import { InputMapper, type MapperDeviceManager, type MapperSceneEngine } from "../../src/input/InputMapper.ts";
import { logger } from "../../src/logger.ts";

/** Build an InputMapping row with sensible defaults. */
function mapping(partial: Partial<InputMapping>): InputMapping {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "rule",
    protocol: partial.protocol ?? "tcp",
    pattern: partial.pattern ?? "/scene/execute",
    targetType: partial.targetType ?? "scene.execute",
    targetId: partial.targetId ?? null,
    targetCommand: partial.targetCommand ?? null,
    paramsTemplate: partial.paramsTemplate ?? {},
    enabled: partial.enabled ?? true,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
  };
}

function fakeRepo(rows: InputMapping[]) {
  return {
    rows,
    listEnabled: async () => rows.filter((r) => r.enabled),
  };
}

function fakeSceneEngine() {
  const calls: Array<{ sceneId: string; source: string; sourceDetail?: string }> = [];
  const engine: MapperSceneEngine = {
    async startScene(sceneId, source, opts) {
      calls.push({ sceneId, source, sourceDetail: opts?.sourceDetail });
      return { executionId: "exec-1", sceneId, status: "running" };
    },
  };
  return { engine, calls };
}

function fakeDeviceManager(result: Partial<CommandResult> = {}) {
  const calls: Array<{ deviceId: string; command: string; params: Record<string, unknown> }> = [];
  const dm: MapperDeviceManager = {
    async execute(deviceId, command, params) {
      calls.push({ deviceId, command, params });
      return { success: true, durationMs: 1, ...result };
    },
  };
  return { dm, calls };
}

describe("InputMapper — cache", () => {
  test("reload caches only enabled mappings, grouped by protocol", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", enabled: true }),
      mapping({ protocol: "osc", enabled: true }),
      mapping({ protocol: "osc", enabled: false }),
    ]);
    const m = new InputMapper({ repo, logger });
    await m.start();
    expect(m.size()).toBe(2);
  });

  test("reload picks up edits", async () => {
    const repo = fakeRepo([mapping({ protocol: "tcp" })]);
    const m = new InputMapper({ repo, logger });
    await m.start();
    expect(m.size()).toBe(1);
    repo.rows.push(mapping({ protocol: "tcp" }));
    await m.reload();
    expect(m.size()).toBe(2);
  });
});

describe("InputMapper — match", () => {
  test("only mappings on the signal's protocol are considered", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", pattern: "/go" }),
      mapping({ protocol: "osc", pattern: "/go" }),
    ]);
    const m = new InputMapper({ repo, logger });
    await m.start();
    const hits = m.match({ protocol: "osc", address: "/go" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.mapping.protocol).toBe("osc");
  });

  test("captures path params and evaluates the template", async () => {
    const repo = fakeRepo([
      mapping({
        protocol: "osc",
        pattern: "/dim/:level",
        targetType: "device.command",
        targetId: "d1",
        targetCommand: "setLevel",
        paramsTemplate: { level: "{:level}" },
      }),
    ]);
    const m = new InputMapper({ repo, logger });
    await m.start();
    const [hit] = m.match({ protocol: "osc", address: "/dim/0.5" });
    expect(hit!.pathParams).toEqual({ level: "0.5" });
    expect(hit!.params).toEqual({ level: 0.5 });
  });

  test("a non-matching address yields no hits", async () => {
    const repo = fakeRepo([mapping({ protocol: "tcp", pattern: "/scene/execute" })]);
    const m = new InputMapper({ repo, logger });
    await m.start();
    expect(m.match({ protocol: "tcp", address: "/nope" })).toEqual([]);
  });
});

describe("InputMapper — dispatch", () => {
  test("scene.execute runs the scene with protocol as source", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", pattern: "/scene/execute", targetType: "scene.execute", targetId: "s1" }),
    ]);
    const { engine, calls } = fakeSceneEngine();
    const m = new InputMapper({ repo, logger, sceneEngine: engine });
    await m.start();
    const outcomes = await m.handle({ protocol: "tcp", address: "/scene/execute" });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.ok).toBe(true);
    expect(calls).toEqual([{ sceneId: "s1", source: "tcp", sourceDetail: "tcp:/scene/execute" }]);
  });

  test("device.command runs the templated command", async () => {
    const repo = fakeRepo([
      mapping({
        protocol: "osc",
        pattern: "/dim/:level",
        targetType: "device.command",
        targetId: "d1",
        targetCommand: "setLevel",
        paramsTemplate: { level: "{:level}" },
      }),
    ]);
    const { dm, calls } = fakeDeviceManager();
    const m = new InputMapper({ repo, logger, deviceManager: dm });
    await m.start();
    await m.handle({ protocol: "osc", address: "/dim/0.75" });
    expect(calls).toEqual([{ deviceId: "d1", command: "setLevel", params: { level: 0.75 } }]);
  });

  test("a failed device command surfaces ok:false", async () => {
    const repo = fakeRepo([
      mapping({
        protocol: "tcp",
        pattern: "/x",
        targetType: "device.command",
        targetId: "d1",
        targetCommand: "on",
      }),
    ]);
    const { dm } = fakeDeviceManager({ success: false, error: "offline" });
    const m = new InputMapper({ repo, logger, deviceManager: dm });
    await m.start();
    const [outcome] = await m.handle({ protocol: "tcp", address: "/x" });
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toBe("offline");
  });

  test("event.emit publishes input.mapping.triggered on the bus", async () => {
    const repo = fakeRepo([
      mapping({
        id: "m-evt",
        name: "doorbell",
        protocol: "tcp",
        pattern: "/ring",
        targetType: "event.emit",
        paramsTemplate: { who: "{arg[0]}" },
      }),
    ]);
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on("input.mapping.triggered", (e) => seen.push(e));
    const m = new InputMapper({ repo, logger, eventBus: bus });
    await m.start();
    await m.handle({ protocol: "tcp", address: "/ring", args: ["visitor"] });
    expect(seen).toEqual([
      { type: "input.mapping.triggered", mappingId: "m-evt", name: "doorbell", params: { who: "visitor" } },
    ]);
  });

  test("a scene.execute rule with no targetId fails gracefully (no throw)", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", pattern: "/go", targetType: "scene.execute", targetId: null }),
    ]);
    const { engine, calls } = fakeSceneEngine();
    const m = new InputMapper({ repo, logger, sceneEngine: engine });
    await m.start();
    const [outcome] = await m.handle({ protocol: "tcp", address: "/go" });
    expect(outcome!.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("multiple rules on the same address all fire", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", pattern: "/all", targetType: "scene.execute", targetId: "s1" }),
      mapping({ protocol: "tcp", pattern: "/all", targetType: "event.emit", name: "log" }),
    ]);
    const { engine } = fakeSceneEngine();
    const bus = new EventBus();
    let events = 0;
    bus.on("input.mapping.triggered", () => events++);
    const m = new InputMapper({ repo, logger, sceneEngine: engine, eventBus: bus });
    await m.start();
    const outcomes = await m.handle({ protocol: "tcp", address: "/all" });
    expect(outcomes).toHaveLength(2);
    expect(events).toBe(1);
  });
});

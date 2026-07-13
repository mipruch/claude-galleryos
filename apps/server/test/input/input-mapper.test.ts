/**
 * InputMapper tests — hermetic, with a fake mappings repo, a fake trigger-action
 * source, and a fake dispatcher (never a real SceneEngine/DeviceManager — those
 * are the TriggerActionDispatcher's concern, covered in
 * `trigger-action-dispatcher.test.ts`). Covers cache reload (joining each
 * mapping with its wired trigger actions), protocol-scoped matching, dispatch
 * fan-out per matched mapping, the template context handed to the dispatcher,
 * and mappings with no wired actions yet (a normal, valid state).
 */

import { describe, expect, test } from "bun:test";
import type { InputMapping, TriggerAction } from "@gallery/types";
import {
  InputMapper,
  type MapperDispatcher,
  type TriggerActionSource,
} from "../../src/input/InputMapper.ts";
import type { TemplateContext, TriggerDispatchOutcome } from "../../src/core/TriggerActionDispatcher.ts";
import { logger } from "../../src/logger.ts";

/** Build an InputMapping row with sensible defaults. */
function mapping(partial: Partial<InputMapping> = {}): InputMapping {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "rule",
    protocol: partial.protocol ?? "tcp",
    pattern: partial.pattern ?? "/scene/execute",
    enabled: partial.enabled ?? true,
    position: partial.position ?? null,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
  };
}

/** Build a TriggerAction row wired to a mapping, with sensible defaults. */
function triggerAction(partial: Partial<TriggerAction> = {}): TriggerAction {
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

function fakeRepo(rows: InputMapping[]) {
  return {
    rows,
    listEnabled: async () => rows.filter((r) => r.enabled),
  };
}

function fakeTriggerActions(rows: TriggerAction[]): TriggerActionSource {
  return {
    listByMappingIds: async (mappingIds: string[]) =>
      rows.filter((a) => a.mappingId && mappingIds.includes(a.mappingId)),
  };
}

function fakeDispatcher() {
  const calls: Array<{
    actions: TriggerAction[];
    source: string;
    sourceDetail: string;
    template?: TemplateContext;
  }> = [];
  const dispatcher: MapperDispatcher = {
    async dispatchAll(actions, source, sourceDetail, template) {
      calls.push({ actions: [...actions], source, sourceDetail, template });
      const outcomes: TriggerDispatchOutcome[] = actions.map((a) => ({
        triggerActionId: a.id,
        targetType: a.targetType,
        ok: true,
      }));
      return outcomes;
    },
  };
  return { dispatcher, calls };
}

describe("InputMapper — cache", () => {
  test("reload caches only enabled mappings, grouped by protocol", async () => {
    const repo = fakeRepo([
      mapping({ protocol: "tcp", enabled: true }),
      mapping({ protocol: "osc", enabled: true }),
      mapping({ protocol: "osc", enabled: false }),
    ]);
    const { dispatcher } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
    await m.start();
    expect(m.size()).toBe(2);
  });

  test("reload picks up edits", async () => {
    const repo = fakeRepo([mapping({ protocol: "tcp" })]);
    const { dispatcher } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
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
    const { dispatcher } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
    await m.start();
    const hits = m.match({ protocol: "osc", address: "/go" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.mapping.protocol).toBe("osc");
  });

  test("captures path params (pure — no dispatch, no trigger actions resolved)", async () => {
    const repo = fakeRepo([mapping({ protocol: "osc", pattern: "/dim/:level" })]);
    const { dispatcher } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
    await m.start();
    const [hit] = m.match({ protocol: "osc", address: "/dim/0.5" });
    expect(hit!.pathParams).toEqual({ level: "0.5" });
  });

  test("a non-matching address yields no hits", async () => {
    const repo = fakeRepo([mapping({ protocol: "tcp", pattern: "/scene/execute" })]);
    const { dispatcher } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
    await m.start();
    expect(m.match({ protocol: "tcp", address: "/nope" })).toEqual([]);
  });
});

describe("InputMapper — handle/dispatch", () => {
  test("dispatches a matched mapping's wired trigger actions with a template context", async () => {
    const rule = mapping({ protocol: "tcp", pattern: "/scene/execute" });
    const wired = triggerAction({ mappingId: rule.id, targetType: "scene.execute", targetId: "s1" });
    const repo = fakeRepo([rule]);
    const { dispatcher, calls } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([wired]), dispatcher, logger });
    await m.start();

    const outcomes = await m.handle({ protocol: "tcp", address: "/scene/execute", args: ["x"] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.actions).toEqual([wired]);
    expect(calls[0]!.source).toBe("tcp");
    expect(calls[0]!.sourceDetail).toBe("tcp:/scene/execute");
    expect(calls[0]!.template).toEqual({ args: ["x"], pathParams: {} });
    expect(outcomes).toEqual([{ triggerActionId: wired.id, targetType: "scene.execute", ok: true }]);
  });

  test("path params captured by the pattern reach the template context", async () => {
    const rule = mapping({ protocol: "osc", pattern: "/dim/:level" });
    const wired = triggerAction({ mappingId: rule.id, targetType: "device.command", targetId: "d1", targetCommand: "setLevel" });
    const repo = fakeRepo([rule]);
    const { dispatcher, calls } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([wired]), dispatcher, logger });
    await m.start();

    await m.handle({ protocol: "osc", address: "/dim/0.75" });

    expect(calls[0]!.template).toEqual({ args: [], pathParams: { level: "0.75" } });
  });

  test("a mapping with no wired trigger actions dispatches nothing", async () => {
    const rule = mapping({ protocol: "tcp", pattern: "/go" });
    const repo = fakeRepo([rule]);
    const { dispatcher, calls } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([]), dispatcher, logger });
    await m.start();

    const outcomes = await m.handle({ protocol: "tcp", address: "/go" });

    expect(outcomes).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("a non-matching address dispatches nothing", async () => {
    const rule = mapping({ protocol: "tcp", pattern: "/go" });
    const wired = triggerAction({ mappingId: rule.id, targetId: "s1" });
    const repo = fakeRepo([rule]);
    const { dispatcher, calls } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([wired]), dispatcher, logger });
    await m.start();

    expect(await m.handle({ protocol: "tcp", address: "/nope" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("multiple matching mappings each dispatch their own wired actions separately", async () => {
    const ruleA = mapping({ id: "m1", protocol: "tcp", pattern: "/all" });
    const ruleB = mapping({ id: "m2", protocol: "tcp", pattern: "/all" });
    const actionA = triggerAction({ mappingId: "m1", targetId: "s1" });
    const actionB = triggerAction({ mappingId: "m2", targetId: "s2" });
    const repo = fakeRepo([ruleA, ruleB]);
    const { dispatcher, calls } = fakeDispatcher();
    const m = new InputMapper({ repo, triggerActions: fakeTriggerActions([actionA, actionB]), dispatcher, logger });
    await m.start();

    const outcomes = await m.handle({ protocol: "tcp", address: "/all" });

    expect(calls).toHaveLength(2);
    expect(outcomes).toHaveLength(2);
  });
});

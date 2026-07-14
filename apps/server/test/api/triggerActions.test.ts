/**
 * Trigger-action routes tests — hermetic (no DB).
 *
 * Mounts the real route map on an ephemeral Bun.serve with a fake repo, fake
 * schedules/mappings/scenes/devices lookups, and a fake InputMapper injected via
 * ApiContext, then drives it over HTTP. Verifies the owner XOR rule, that a
 * given `targetId` must resolve but an omitted one (unwired) is valid, and that
 * only a mapping-owned mutation reloads the live InputMapper cache (a
 * schedule-owned one needs no cache — the Scheduler fetches fresh per fire).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { triggerActionsRoutes } from "../../src/api/routes/triggerActions.ts";
import type { ApiContext } from "../../src/api/context.ts";

let store: Record<string, Record<string, unknown>>;
let reloadCount = 0;

const baseAction = {
  id: "ta1",
  scheduleId: "j1",
  mappingId: null,
  targetType: "scene.execute",
  targetId: "s1",
  targetCommand: null,
  params: {},
};

const fakeTriggerActions = {
  async list() {
    return Object.values(store);
  },
  async listByScheduleId(scheduleId: string) {
    return Object.values(store).filter((a) => a.scheduleId === scheduleId);
  },
  async listByMappingId(mappingId: string) {
    return Object.values(store).filter((a) => a.mappingId === mappingId);
  },
  async get(id: string) {
    return store[id];
  },
  async create(values: Record<string, unknown>) {
    const row = { id: "ta-new", targetCommand: null, params: {}, ...values };
    store["ta-new"] = row;
    return row;
  },
  async update(id: string, values: Record<string, unknown>) {
    if (!store[id]) return undefined;
    store[id] = { ...store[id], ...values };
    return store[id];
  },
  async remove(id: string) {
    const existing = store[id];
    delete store[id];
    return existing;
  },
};

const fakeSchedules = { async get(id: string) { return id === "j1" ? { id: "j1" } : undefined; } };
const fakeMappings = { async get(id: string) { return id === "m1" ? { id: "m1" } : undefined; } };
const fakeScenes = { async get(id: string) { return id === "s1" ? { id: "s1" } : undefined; } };
const fakeDevices = { async get(id: string) { return id === "d1" ? { id: "d1" } : undefined; } };
const fakeInputMapper = { reload: async () => void reloadCount++ };

const ctx = {
  triggerActions: fakeTriggerActions,
  schedules: fakeSchedules,
  mappings: fakeMappings,
  scenes: fakeScenes,
  devices: fakeDevices,
  inputMapper: fakeInputMapper,
} as unknown as ApiContext;

let server: Server<unknown>;
let base: string;

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...triggerActionsRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));
beforeEach(() => {
  store = { ta1: { ...baseAction } };
  reloadCount = 0;
});

describe("trigger-actions listing", () => {
  test("GET /trigger-actions lists all", async () => {
    const { status, body } = await req("GET", "/api/v1/trigger-actions");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
  });

  test("GET /trigger-actions?scheduleId= scopes to that schedule", async () => {
    store["ta2"] = { ...baseAction, id: "ta2", scheduleId: "other" };
    const { body } = await req("GET", "/api/v1/trigger-actions?scheduleId=j1");
    expect(body).toEqual([store.ta1]);
  });

  test("GET /trigger-actions?mappingId= scopes to that mapping", async () => {
    store["ta2"] = { ...baseAction, id: "ta2", scheduleId: null, mappingId: "m1" };
    const { body } = await req("GET", "/api/v1/trigger-actions?mappingId=m1");
    expect(body).toEqual([store.ta2]);
  });
});

describe("POST /trigger-actions — owner rule", () => {
  test("requires exactly one of scheduleId/mappingId — rejects neither", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", { targetType: "scene.execute" });
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });

  test("rejects both scheduleId and mappingId set", async () => {
    const { status } = await req("POST", "/api/v1/trigger-actions", {
      targetType: "scene.execute",
      scheduleId: "j1",
      mappingId: "m1",
    });
    expect(status).toBe(400);
  });

  test("rejects an unknown scheduleId", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      targetType: "scene.execute",
      scheduleId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("schedule not found");
  });

  test("rejects an unknown mappingId", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      targetType: "scene.execute",
      mappingId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("mapping not found");
  });

  test("requires targetType and rejects an unknown one", async () => {
    expect((await req("POST", "/api/v1/trigger-actions", { scheduleId: "j1" })).status).toBe(400);
    expect(
      (await req("POST", "/api/v1/trigger-actions", { scheduleId: "j1", targetType: "self.destruct" })).status,
    ).toBe(400);
  });
});

describe("POST /trigger-actions — target wiring", () => {
  test("an omitted targetId is valid (unwired) and skips target-existence checks", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      targetType: "scene.execute",
    });
    expect(status).toBe(201);
    expect(body.targetId).toBeNull();
  });

  test("a given targetId must resolve to a seeded scene", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      targetType: "scene.execute",
      targetId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("scene not found");
  });

  test("a given targetId must resolve to a seeded device", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      targetType: "device.command",
      targetId: "nope",
      targetCommand: "on",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("device not found");
  });

  test("a schedule-owned action creates without reloading the InputMapper", async () => {
    const { status } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      targetType: "scene.execute",
      targetId: "s1",
    });
    expect(status).toBe(201);
    expect(reloadCount).toBe(0);
  });

  test("a mapping-owned action creates and reloads the InputMapper", async () => {
    const { status } = await req("POST", "/api/v1/trigger-actions", {
      mappingId: "m1",
      targetType: "device.command",
      targetId: "d1",
      targetCommand: "on",
    });
    expect(status).toBe(201);
    expect(reloadCount).toBe(1);
  });
});

describe("trigger-actions single-resource routes", () => {
  test("GET /:id → 404 for unknown, 200 for known", async () => {
    expect((await req("GET", "/api/v1/trigger-actions/nope")).status).toBe(404);
    expect((await req("GET", "/api/v1/trigger-actions/ta1")).status).toBe(200);
  });

  test("PUT updates the target and reloads only when mapping-owned", async () => {
    store["ta2"] = { ...baseAction, id: "ta2", scheduleId: null, mappingId: "m1", targetId: null, targetCommand: null };

    const scheduleOwned = await req("PUT", "/api/v1/trigger-actions/ta1", { targetId: "s1" });
    expect(scheduleOwned.status).toBe(200);
    expect(reloadCount).toBe(0);

    const mappingOwned = await req("PUT", "/api/v1/trigger-actions/ta2", {
      targetType: "device.command",
      targetId: "d1",
      targetCommand: "on",
    });
    expect(mappingOwned.status).toBe(200);
    expect(reloadCount).toBe(1);
  });

  test("PUT re-validates the effective target (merge of patch over current row)", async () => {
    // ta1 already has targetId "s1"; switching targetType to device.command
    // without a valid device id must fail even though targetId is untouched.
    const { status } = await req("PUT", "/api/v1/trigger-actions/ta1", { targetType: "device.command" });
    expect(status).toBe(400);
  });

  test("PUT on unknown id → 404", async () => {
    expect((await req("PUT", "/api/v1/trigger-actions/nope", { targetId: "s1" })).status).toBe(404);
  });

  test("DELETE removes and reloads only when mapping-owned; unknown → 404", async () => {
    expect((await req("DELETE", "/api/v1/trigger-actions/ta1")).status).toBe(204);
    expect(reloadCount).toBe(0); // ta1 was schedule-owned

    store["ta2"] = { ...baseAction, id: "ta2", scheduleId: null, mappingId: "m1" };
    expect((await req("DELETE", "/api/v1/trigger-actions/ta2")).status).toBe(204);
    expect(reloadCount).toBe(1);

    expect((await req("DELETE", "/api/v1/trigger-actions/nope")).status).toBe(404);
  });
});

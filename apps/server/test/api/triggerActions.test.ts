/**
 * Trigger-action routes tests — hermetic (no DB).
 *
 * Mounts the real route map on an ephemeral Bun.serve with a fake repo, fake
 * schedule/mapping/workflow-target lookups, and a fake InputMapper injected
 * via ApiContext, then drives it over HTTP. Verifies the owner XOR rule, that
 * `workflowTargetId` is required and must resolve to a known instance, and
 * that only a mapping-owned mutation reloads the live InputMapper cache (a
 * schedule-owned one needs no cache — the Scheduler fetches fresh per fire).
 * There is no PUT route — a pure link row has nothing else to configure.
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
  workflowTargetId: "wt1",
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
    const row = { id: "ta-new", ...values };
    store["ta-new"] = row;
    return row;
  },
  async remove(id: string) {
    const existing = store[id];
    delete store[id];
    return existing;
  },
};

const fakeSchedules = { async get(id: string) { return id === "j1" ? { id: "j1" } : undefined; } };
const fakeMappings = { async get(id: string) { return id === "m1" ? { id: "m1" } : undefined; } };
const fakeWorkflowTargets = {
  async get(id: string) {
    if (id === "wt1") return { id: "wt1", targetType: "scene.execute", targetId: "s1" };
    if (id === "wt2") return { id: "wt2", targetType: "device.command", targetId: "d1", targetCommand: "on" };
    return undefined;
  },
};
const fakeInputMapper = { reload: async () => void reloadCount++ };

const ctx = {
  triggerActions: fakeTriggerActions,
  schedules: fakeSchedules,
  mappings: fakeMappings,
  workflowTargets: fakeWorkflowTargets,
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
    const { status, body } = await req("POST", "/api/v1/trigger-actions", { workflowTargetId: "wt1" });
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });

  test("rejects both scheduleId and mappingId set", async () => {
    const { status } = await req("POST", "/api/v1/trigger-actions", {
      workflowTargetId: "wt1",
      scheduleId: "j1",
      mappingId: "m1",
    });
    expect(status).toBe(400);
  });

  test("rejects an unknown scheduleId", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      workflowTargetId: "wt1",
      scheduleId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("schedule not found");
  });

  test("rejects an unknown mappingId", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      workflowTargetId: "wt1",
      mappingId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("mapping not found");
  });
});

describe("POST /trigger-actions — workflow target wiring", () => {
  test("requires workflowTargetId", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", { scheduleId: "j1" });
    expect(status).toBe(400);
    expect(body.error).toContain("workflowTargetId is required");
  });

  test("a workflowTargetId that does not resolve is rejected", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      workflowTargetId: "nope",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("workflow target not found");
  });

  test("a schedule-owned wire creates without reloading the InputMapper", async () => {
    const { status, body } = await req("POST", "/api/v1/trigger-actions", {
      scheduleId: "j1",
      workflowTargetId: "wt2",
    });
    expect(status).toBe(201);
    expect(body.workflowTargetId).toBe("wt2");
    expect(reloadCount).toBe(0);
  });

  test("a mapping-owned wire creates and reloads the InputMapper", async () => {
    const { status } = await req("POST", "/api/v1/trigger-actions", {
      mappingId: "m1",
      workflowTargetId: "wt2",
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

  test("DELETE removes and reloads only when mapping-owned; unknown → 404", async () => {
    expect((await req("DELETE", "/api/v1/trigger-actions/ta1")).status).toBe(204);
    expect(reloadCount).toBe(0); // ta1 was schedule-owned

    store["ta2"] = { ...baseAction, id: "ta2", scheduleId: null, mappingId: "m1" };
    expect((await req("DELETE", "/api/v1/trigger-actions/ta2")).status).toBe(204);
    expect(reloadCount).toBe(1);

    expect((await req("DELETE", "/api/v1/trigger-actions/nope")).status).toBe(404);
  });
});

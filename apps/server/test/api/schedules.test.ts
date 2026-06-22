/**
 * Schedules routes tests — hermetic (no DB / no real Scheduler).
 *
 * Mounts the real route map on an ephemeral Bun.serve with fake repos + a fake
 * Scheduler injected via ApiContext, then drives it over HTTP. Verifies request
 * shaping, cron/timezone validation (→ 400), scene-existence checks, the next-runs
 * preview, and that every mutation also notifies the live Scheduler.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { schedulesRoutes } from "../../src/api/routes/schedules.ts";
import type { ApiContext } from "../../src/api/context.ts";

// ── fakes (reset before each test) ───────────────────────────

let store: Record<string, Record<string, unknown>>;
let schedulerCalls: Array<{ fn: string; arg: unknown }>;

const baseJob = {
  id: "j1",
  name: "Morning lights",
  sceneId: "s1",
  cron: "30 8 * * 1-5",
  timezone: "Europe/Prague",
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
};

const fakeSchedules = {
  async list() {
    return Object.values(store);
  },
  async get(id: string) {
    return store[id];
  },
  async create(values: Record<string, unknown>) {
    const job = { ...baseJob, ...values, id: "j-new" };
    store["j-new"] = job;
    return job;
  },
  async update(id: string, values: Record<string, unknown>) {
    if (!store[id]) return undefined;
    store[id] = { ...store[id], ...values };
    return store[id];
  },
  async setEnabled(id: string, enabled: boolean) {
    if (!store[id]) return undefined;
    store[id] = { ...store[id], enabled };
    return store[id];
  },
  async remove(id: string) {
    const existing = store[id];
    delete store[id];
    return existing;
  },
};

const fakeScenes = {
  async get(id: string) {
    return id === "s1" ? { id: "s1", name: "Scene 1", actions: [] } : undefined;
  },
};

const fakeScheduler = {
  addJob: (job: unknown) => schedulerCalls.push({ fn: "addJob", arg: job }),
  removeJob: (id: unknown) => schedulerCalls.push({ fn: "removeJob", arg: id }),
  reloadJob: async (id: unknown) => {
    schedulerCalls.push({ fn: "reloadJob", arg: id });
  },
};

const ctx = {
  schedules: fakeSchedules,
  scenes: fakeScenes,
  scheduler: fakeScheduler,
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

beforeEach(() => {
  store = { j1: { ...baseJob } };
  schedulerCalls = [];
});

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...schedulesRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("schedules CRUD", () => {
  test("GET /schedules lists jobs", async () => {
    const { status, body } = await req("GET", "/api/v1/schedules");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("j1");
  });

  test("POST creates a job and arms the scheduler", async () => {
    const { status, body } = await req("POST", "/api/v1/schedules", {
      name: "Evening",
      sceneId: "s1",
      cron: "0 22 * * *",
      timezone: "UTC",
    });
    expect(status).toBe(201);
    expect(body.id).toBe("j-new");
    expect(schedulerCalls).toEqual([{ fn: "addJob", arg: store["j-new"] }]);
  });

  test("POST rejects an invalid cron with 400 (and never touches the scheduler)", async () => {
    const { status, body } = await req("POST", "/api/v1/schedules", {
      name: "Bad",
      sceneId: "s1",
      cron: "99 8 * * *",
    });
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(schedulerCalls).toHaveLength(0);
  });

  test("POST rejects an invalid timezone with 400", async () => {
    const { status } = await req("POST", "/api/v1/schedules", {
      name: "Bad TZ",
      sceneId: "s1",
      cron: "0 8 * * *",
      timezone: "Mars/Olympus",
    });
    expect(status).toBe(400);
  });

  test("POST rejects an unknown scene with 400", async () => {
    const { status, body } = await req("POST", "/api/v1/schedules", {
      name: "Ghost scene",
      sceneId: "nope",
      cron: "0 8 * * *",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("scene not found");
  });

  test("POST requires name, sceneId and cron", async () => {
    expect((await req("POST", "/api/v1/schedules", { name: "x" })).status).toBe(400);
  });

  test("POST rejects a non-boolean enabled with 400", async () => {
    const { status } = await req("POST", "/api/v1/schedules", {
      name: "x",
      sceneId: "s1",
      cron: "0 8 * * *",
      enabled: "yes",
    });
    expect(status).toBe(400);
    expect(schedulerCalls).toHaveLength(0);
  });

  test("GET /:id returns 404 for unknown, 200 for known", async () => {
    expect((await req("GET", "/api/v1/schedules/nope")).status).toBe(404);
    expect((await req("GET", "/api/v1/schedules/j1")).status).toBe(200);
  });

  test("PUT updates and reloads the scheduler", async () => {
    const { status, body } = await req("PUT", "/api/v1/schedules/j1", { cron: "0 9 * * *" });
    expect(status).toBe(200);
    expect(body.cron).toBe("0 9 * * *");
    expect(schedulerCalls).toEqual([{ fn: "reloadJob", arg: "j1" }]);
  });

  test("PUT rejects an invalid cron with 400", async () => {
    const { status } = await req("PUT", "/api/v1/schedules/j1", { cron: "* * *" });
    expect(status).toBe(400);
    expect(schedulerCalls).toHaveLength(0);
  });

  test("PUT on unknown id → 404", async () => {
    expect((await req("PUT", "/api/v1/schedules/nope", { name: "x" })).status).toBe(404);
  });

  test("PUT rejects a non-boolean enabled with 400", async () => {
    const { status } = await req("PUT", "/api/v1/schedules/j1", { enabled: "yes" });
    expect(status).toBe(400);
    expect(schedulerCalls).toHaveLength(0);
  });

  test("DELETE removes the job and unregisters the timer", async () => {
    const { status } = await req("DELETE", "/api/v1/schedules/j1");
    expect(status).toBe(204);
    expect(schedulerCalls).toEqual([{ fn: "removeJob", arg: "j1" }]);
    expect((await req("GET", "/api/v1/schedules/j1")).status).toBe(404);
  });

  test("DELETE on unknown id → 404", async () => {
    expect((await req("DELETE", "/api/v1/schedules/nope")).status).toBe(404);
  });
});

describe("schedules toggle", () => {
  test("explicit enabled sets the state and reloads", async () => {
    const { status, body } = await req("PATCH", "/api/v1/schedules/j1/toggle", { enabled: false });
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(schedulerCalls).toEqual([{ fn: "reloadJob", arg: "j1" }]);
  });

  test("omitting enabled flips the current value", async () => {
    // baseJob starts enabled=true → toggling without a body disables it.
    const { status, body } = await req("PATCH", "/api/v1/schedules/j1/toggle");
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
  });

  test("toggle on unknown id → 404", async () => {
    expect((await req("PATCH", "/api/v1/schedules/nope/toggle", { enabled: true })).status).toBe(404);
  });

  test("toggle rejects malformed JSON with 400 (no silent flip)", async () => {
    const res = await fetch(`${base}/api/v1/schedules/j1/toggle`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    expect(store.j1?.enabled).toBe(true); // unchanged
  });

  test("toggle rejects a non-boolean enabled with 400", async () => {
    expect((await req("PATCH", "/api/v1/schedules/j1/toggle", { enabled: 1 })).status).toBe(400);
  });
});

describe("schedules next-runs preview", () => {
  test("GET /:id/next returns upcoming UTC fire times (default 5)", async () => {
    const { status, body } = await req("GET", "/api/v1/schedules/j1/next");
    expect(status).toBe(200);
    expect(body.id).toBe("j1");
    expect(body.nextRuns).toHaveLength(5);
    // ISO UTC strings, strictly increasing.
    for (const s of body.nextRuns) expect(s).toMatch(/Z$/);
    const ms = body.nextRuns.map((s: string) => Date.parse(s));
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });

  test("GET /:id/next honours ?count=", async () => {
    const { body } = await req("GET", "/api/v1/schedules/j1/next?count=3");
    expect(body.nextRuns).toHaveLength(3);
  });

  test("GET /:id/next on unknown id → 404", async () => {
    expect((await req("GET", "/api/v1/schedules/nope/next")).status).toBe(404);
  });
});

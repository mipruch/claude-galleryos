/**
 * Logs routes tests — hermetic (no DB).
 *
 * Spins up the real route map on an ephemeral Bun.serve with fake `logs` and
 * `sceneExecutions` repos injected via ApiContext, then drives it over HTTP.
 * This exercises query-param parsing, validation, and response shaping without
 * touching TimescaleDB.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { logsRoutes } from "../../src/api/routes/logs.ts";
import type { ApiContext } from "../../src/api/context.ts";
import type { LogFilter } from "../../src/db/repositories.ts";

// Capture the args the route passes to the repos so we can assert on parsing.
let lastListFilter: LogFilter | null = null;
let lastStatsSince: Date[] = [];
let lastExecOpts: { sceneId?: string; status?: string; limit?: number } | null = null;

const fakeLogs = {
  async list(filter: LogFilter) {
    lastListFilter = filter;
    return [{ id: 1, level: "info", source: "test", message: "hello", ts: new Date() }];
  },
  async statsByLevel(since: Date) {
    lastStatsSince.push(since);
    return [{ level: "info", count: 3 }];
  },
};

const fakeExecutions = {
  async list(opts: { sceneId?: string; status?: string; limit?: number }) {
    lastExecOpts = opts;
    return [{ id: "exec-1", sceneName: "Welcome", status: "completed" }];
  },
};

const ctx = {
  logs: fakeLogs,
  sceneExecutions: fakeExecutions,
} as unknown as ApiContext;

let server: Server<unknown>;
let base: string;

/** Fetch + parse JSON with a loose type so assertions read cleanly. */
async function getJson(path: string): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...logsRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("GET /api/v1/logs", () => {
  test("passes filters and pagination through to the repo", async () => {
    const { status, body } = await getJson(
      "/api/v1/logs?level=error&source=device_manager&entity_id=dev-1&limit=25&offset=50",
    );
    expect(status).toBe(200);
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);
    expect(body.count).toBe(1);
    expect(lastListFilter?.level).toBe("error");
    expect(lastListFilter?.source).toBe("device_manager");
    expect(lastListFilter?.entityId).toBe("dev-1");
  });

  test("defaults limit/offset when omitted", async () => {
    const { body } = await getJson("/api/v1/logs");
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });

  test("parses ISO date bounds", async () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-02-01T00:00:00.000Z";
    await fetch(`${base}/api/v1/logs?from=${from}&to=${to}`);
    expect(lastListFilter?.from?.toISOString()).toBe(from);
    expect(lastListFilter?.to?.toISOString()).toBe(to);
  });

  test("rejects a non-integer limit with 400", async () => {
    const { status, body } = await getJson("/api/v1/logs?limit=abc");
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });

  test("rejects an invalid date with 400", async () => {
    const { status } = await getJson("/api/v1/logs?from=not-a-date");
    expect(status).toBe(400);
  });
});

describe("GET /api/v1/logs/stats", () => {
  test("returns byLevel buckets for 24h and 7d", async () => {
    lastStatsSince = [];
    const { status, body } = await getJson("/api/v1/logs/stats");
    expect(status).toBe(200);
    expect(body.last24h.byLevel).toEqual([{ level: "info", count: 3 }]);
    expect(body.last7d.byLevel).toEqual([{ level: "info", count: 3 }]);
    // Two windows queried; the 7d 'since' is earlier than the 24h 'since'.
    expect(lastStatsSince).toHaveLength(2);
    const [a, b] = lastStatsSince;
    expect(Math.abs(a!.getTime() - b!.getTime())).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/logs/executions", () => {
  test("passes scene_id/status/limit through and shapes the response", async () => {
    const { status, body } = await getJson(
      "/api/v1/logs/executions?scene_id=s-1&status=failed&limit=10",
    );
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.executions[0].sceneName).toBe("Welcome");
    expect(lastExecOpts?.sceneId).toBe("s-1");
    expect(lastExecOpts?.status).toBe("failed");
    expect(lastExecOpts?.limit).toBe(10);
  });
});

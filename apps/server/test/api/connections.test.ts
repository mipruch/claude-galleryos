/**
 * Connections routes tests — hermetic (no DB / Redis / subprocesses).
 *
 * Mounts the real route map on an ephemeral Bun.serve with fake repos, a fake
 * live-state store and a fake DeviceManager injected via ApiContext, then drives
 * it over HTTP. Focuses on the batched `/connections/live` snapshot and the
 * enable/disable lifecycle (PUT restarts/stops the driver host).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { connectionsRoutes } from "../../src/api/routes/connections.ts";
import type { ApiContext } from "../../src/api/context.ts";

const rows: Record<string, Record<string, unknown>> = {
  c1: { id: "c1", name: "BSS", driverId: "bss-soundweb", host: "10.0.0.1", port: 1023, protocol: "tcp", enabled: true },
  c2: { id: "c2", name: "Projector", driverId: "pjlink", host: "10.0.0.2", port: 4352, protocol: "tcp", enabled: false },
};

const statuses: Record<string, Record<string, unknown>> = {
  c1: { online: true, latencyMs: 12 },
  c2: { online: false, lastError: "disabled" },
};

const running = new Set<string>(["c1"]);
const calls: string[] = [];

const fakeConnections = {
  async list() {
    return Object.values(rows);
  },
  async get(id: string) {
    return rows[id];
  },
  async update(id: string, values: Record<string, unknown>) {
    if (!rows[id]) return undefined;
    rows[id] = { ...rows[id], ...values };
    return rows[id];
  },
  async deviceCount() {
    return 0;
  },
};

const fakeState = {
  async getConnectionStatus(id: string) {
    return statuses[id] ?? null;
  },
};

const fakeDeviceManager = {
  isConnectionRunning: (id: string) => running.has(id),
  async addConnection(c: { id: string }) {
    calls.push(`add:${c.id}`);
    running.add(c.id);
  },
  async stopConnection(id: string) {
    calls.push(`stop:${id}`);
    running.delete(id);
  },
};

const fakeRegistry = { has: () => true };

const ctx = {
  connections: fakeConnections,
  state: fakeState,
  deviceManager: fakeDeviceManager,
  driverRegistry: fakeRegistry,
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
  server = Bun.serve({ port: 0, routes: { ...connectionsRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("connections status", () => {
  test("GET /connections attaches the runtime running flag", async () => {
    const { status, body } = await req("GET", "/api/v1/connections");
    expect(status).toBe(200);
    const c1 = body.find((c: { id: string }) => c.id === "c1");
    const c2 = body.find((c: { id: string }) => c.id === "c2");
    expect(c1.running).toBe(true);
    expect(c2.running).toBe(false);
  });

  test("GET /connections/live returns a status map for every connection", async () => {
    const { status, body } = await req("GET", "/api/v1/connections/live");
    expect(status).toBe(200);
    expect(body.c1).toMatchObject({ online: true, latencyMs: 12 });
    expect(body.c2).toMatchObject({ online: false, lastError: "disabled" });
  });

  test("PUT /connections/:id enabled=true starts the driver host", async () => {
    calls.length = 0;
    const { status, body } = await req("PUT", "/api/v1/connections/c2", { enabled: true });
    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.running).toBe(true);
    // Restart semantics: stop first, then (re)start because it's now enabled.
    expect(calls).toEqual(["stop:c2", "add:c2"]);
  });

  test("PUT /connections/:id enabled=false stops the driver host", async () => {
    calls.length = 0;
    const { status, body } = await req("PUT", "/api/v1/connections/c1", { enabled: false });
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.running).toBe(false);
    expect(calls).toEqual(["stop:c1"]);
  });
});

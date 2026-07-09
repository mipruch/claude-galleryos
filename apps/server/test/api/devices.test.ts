/**
 * Device route role-scoping tests — hermetic (no DB). Covers `?role_id=` on
 * GET /devices and GET /devices/live: the server, not the client, decides
 * what a role may see (see `filterByRole` in `routes/devices.ts`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { devicesRoutes } from "../../src/api/routes/devices.ts";
import type { ApiContext } from "../../src/api/context.ts";

const ALL_DEVICES = [
  { id: "d1", name: "Light 1" },
  { id: "d2", name: "Light 2" },
  { id: "d3", name: "Projector" },
];

let rolesStore: Record<string, { id: string; isAdmin: boolean; deviceIds: string[] }>;

const ctx = {
  devices: {
    async list() {
      return ALL_DEVICES;
    },
  },
  roles: {
    async get(id: string) {
      return rolesStore[id];
    },
  },
  state: {
    async getDeviceState() {
      return {};
    },
    async getDeviceStatus() {
      return { online: false };
    },
  },
} as unknown as ApiContext;

let server: Server<unknown>;
let base: string;

async function req(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  rolesStore = {
    "r-admin": { id: "r-admin", isAdmin: true, deviceIds: [] },
    "r-scoped": { id: "r-scoped", isAdmin: false, deviceIds: ["d2"] },
    "r-empty": { id: "r-empty", isAdmin: false, deviceIds: [] },
  };
});

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...devicesRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("GET /devices?role_id=", () => {
  test("no role_id returns everything, unchanged from before", async () => {
    const { status, body } = await req("/api/v1/devices");
    expect(status).toBe(200);
    expect(body.map((d: { id: string }) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  test("an admin role sees everything", async () => {
    const { body } = await req("/api/v1/devices?role_id=r-admin");
    expect(body.map((d: { id: string }) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  test("a scoped role only sees its role_devices", async () => {
    const { body } = await req("/api/v1/devices?role_id=r-scoped");
    expect(body.map((d: { id: string }) => d.id)).toEqual(["d2"]);
  });

  test("a role with no devices granted sees nothing", async () => {
    const { body } = await req("/api/v1/devices?role_id=r-empty");
    expect(body).toEqual([]);
  });

  test("an unknown role_id is treated like no filter (fails open)", async () => {
    const { body } = await req("/api/v1/devices?role_id=does-not-exist");
    expect(body.map((d: { id: string }) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("GET /devices/live?role_id=", () => {
  test("scopes the snapshot map to the role's devices", async () => {
    const { status, body } = await req("/api/v1/devices/live?role_id=r-scoped");
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["d2"]);
  });

  test("no role_id returns the full snapshot", async () => {
    const { body } = await req("/api/v1/devices/live");
    expect(Object.keys(body)).toEqual(["d1", "d2", "d3"]);
  });
});

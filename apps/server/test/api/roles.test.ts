/**
 * Role CRUD routes tests — hermetic (no DB). Covers the `deviceIds` n:n
 * replace-on-write behaviour and the user-count guard on delete.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { rolesRoutes } from "../../src/api/routes/roles.ts";
import type { ApiContext } from "../../src/api/context.ts";

let rolesStore: Record<string, Record<string, unknown>>;
let deviceIdsByRole: Record<string, string[]>;
let userCountByRole: Record<string, number>;
let nextId: number;

const fakeRoles = {
  async list() {
    return Object.values(rolesStore).map((r) => ({ ...r, deviceIds: deviceIdsByRole[r.id as string] ?? [] }));
  },
  async get(id: string) {
    const role = rolesStore[id];
    return role ? { ...role, deviceIds: deviceIdsByRole[id] ?? [] } : undefined;
  },
  async create(values: Record<string, unknown>, deviceIds: string[] = []) {
    if (Object.values(rolesStore).some((r) => r.name === values.name)) {
      throw new Error('duplicate key value violates unique constraint "idx_roles_name"');
    }
    const id = `r${nextId++}`;
    rolesStore[id] = { id, ...values };
    deviceIdsByRole[id] = deviceIds;
    return { ...rolesStore[id], deviceIds };
  },
  async update(id: string, values: Record<string, unknown>, deviceIds?: string[]) {
    if (!rolesStore[id]) return undefined;
    const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    rolesStore[id] = { ...rolesStore[id], ...patch };
    if (deviceIds !== undefined) deviceIdsByRole[id] = deviceIds;
    return { ...rolesStore[id], deviceIds: deviceIdsByRole[id] ?? [] };
  },
  async remove(id: string) {
    const existing = rolesStore[id];
    delete rolesStore[id];
    delete deviceIdsByRole[id];
    return existing;
  },
  async userCount(id: string) {
    return userCountByRole[id] ?? 0;
  },
};

const ctx = { roles: fakeRoles } as unknown as ApiContext;

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
  nextId = 1;
  rolesStore = { r0: { id: "r0", name: "Custodian", isAdmin: false, description: null } };
  deviceIdsByRole = { r0: ["d1", "d2"] };
  userCountByRole = {};
});

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...rolesRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("roles CRUD", () => {
  test("GET /roles lists roles with their deviceIds", async () => {
    const { status, body } = await req("GET", "/api/v1/roles");
    expect(status).toBe(200);
    expect(body[0].deviceIds).toEqual(["d1", "d2"]);
  });

  test("POST creates a role with a device list", async () => {
    const { status, body } = await req("POST", "/api/v1/roles", { name: "Barista", deviceIds: ["d3"] });
    expect(status).toBe(201);
    expect(body.isAdmin).toBe(false);
    expect(body.deviceIds).toEqual(["d3"]);
  });

  test("POST defaults isAdmin to false and deviceIds to empty", async () => {
    const { body } = await req("POST", "/api/v1/roles", { name: "Plain" });
    expect(body.isAdmin).toBe(false);
    expect(body.deviceIds).toEqual([]);
  });

  test("POST rejects a duplicate name with 409", async () => {
    const { status } = await req("POST", "/api/v1/roles", { name: "Custodian" });
    expect(status).toBe(409);
  });

  test("POST rejects non-string deviceIds with 400", async () => {
    const { status } = await req("POST", "/api/v1/roles", { name: "x", deviceIds: [1, 2] });
    expect(status).toBe(400);
  });

  test("POST requires name", async () => {
    expect((await req("POST", "/api/v1/roles", {})).status).toBe(400);
  });

  test("GET /:id 404s for unknown, 200 for known", async () => {
    expect((await req("GET", "/api/v1/roles/ghost")).status).toBe(404);
    expect((await req("GET", "/api/v1/roles/r0")).status).toBe(200);
  });

  test("PUT replaces the device list", async () => {
    const { status, body } = await req("PUT", "/api/v1/roles/r0", { deviceIds: ["d9"] });
    expect(status).toBe(200);
    expect(body.deviceIds).toEqual(["d9"]);
  });

  test("PUT omitting deviceIds leaves the existing set untouched", async () => {
    const { body } = await req("PUT", "/api/v1/roles/r0", { description: "updated" });
    expect(body.deviceIds).toEqual(["d1", "d2"]);
    expect(body.description).toBe("updated");
  });

  test("PUT on unknown id → 404", async () => {
    expect((await req("PUT", "/api/v1/roles/ghost", { name: "x" })).status).toBe(404);
  });

  test("DELETE is blocked while a user holds the role", async () => {
    userCountByRole.r0 = 1;
    const { status, body } = await req("DELETE", "/api/v1/roles/r0");
    expect(status).toBe(409);
    expect(body.error).toContain("reassign");
  });

  test("DELETE removes an unassigned role", async () => {
    expect((await req("DELETE", "/api/v1/roles/r0")).status).toBe(204);
    expect((await req("GET", "/api/v1/roles/r0")).status).toBe(404);
  });

  test("DELETE on unknown id → 404", async () => {
    expect((await req("DELETE", "/api/v1/roles/ghost")).status).toBe(404);
  });
});

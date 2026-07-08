/**
 * Auth routes tests — hermetic (no DB). This is a one-shot credential check,
 * not a session: no cookie is ever set, so there's nothing to assert about
 * beyond the returned body and status.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { authRoutes } from "../../src/api/routes/auth.ts";
import type { ApiContext } from "../../src/api/context.ts";

let usersStore: Record<string, Record<string, unknown>>;
let rolesStore: Record<string, Record<string, unknown>>;

const fakeUsers = {
  async getByUsername(username: string) {
    return Object.values(usersStore).find((u) => u.username === username);
  },
};

const fakeRoles = {
  async get(id: string) {
    return rolesStore[id];
  },
};

const ctx = { users: fakeUsers, roles: fakeRoles } as unknown as ApiContext;

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

beforeEach(async () => {
  rolesStore = { r1: { id: "r1", name: "Admin", isAdmin: true, deviceIds: [] } };
  usersStore = {
    u1: {
      id: "u1",
      username: "admin",
      passwordHash: await Bun.password.hash("secret123"),
      roleId: "r1",
      displayName: "Administrator",
      enabled: true,
    },
  };
});

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...authRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("POST /auth/login", () => {
  test("valid credentials return user + role, no passwordHash", async () => {
    const { status, body } = await req("POST", "/api/v1/auth/login", {
      username: "admin",
      password: "secret123",
    });
    expect(status).toBe(200);
    expect(body.user.username).toBe("admin");
    expect(body.role.isAdmin).toBe(true);
    expect(body.user.passwordHash).toBeUndefined();
  });

  test("wrong password → 401 with a generic message", async () => {
    const { status, body } = await req("POST", "/api/v1/auth/login", {
      username: "admin",
      password: "wrong",
    });
    expect(status).toBe(401);
    expect(body.error).toBe("invalid username or password");
  });

  test("unknown username → 401 with the same generic message", async () => {
    const { status, body } = await req("POST", "/api/v1/auth/login", {
      username: "ghost",
      password: "whatever",
    });
    expect(status).toBe(401);
    expect(body.error).toBe("invalid username or password");
  });

  test("disabled user → 401", async () => {
    usersStore.u1!.enabled = false;
    const { status } = await req("POST", "/api/v1/auth/login", { username: "admin", password: "secret123" });
    expect(status).toBe(401);
  });

  test("missing fields → 400", async () => {
    const { status } = await req("POST", "/api/v1/auth/login", { username: "admin" });
    expect(status).toBe(400);
  });
});

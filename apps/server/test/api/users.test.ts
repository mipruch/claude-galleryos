/**
 * User CRUD routes tests — hermetic (no DB).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { usersRoutes } from "../../src/api/routes/users.ts";
import type { ApiContext } from "../../src/api/context.ts";

let usersStore: Record<string, Record<string, unknown>>;
let nextId: number;

const fakeUsers = {
  async list() {
    return Object.values(usersStore);
  },
  async get(id: string) {
    return usersStore[id];
  },
  async create(values: Record<string, unknown>) {
    if (Object.values(usersStore).some((u) => u.username === values.username)) {
      throw new Error('duplicate key value violates unique constraint "idx_users_username"');
    }
    const id = `u${nextId++}`;
    const user = { id, createdAt: new Date(), updatedAt: new Date(), ...values };
    usersStore[id] = user;
    return user;
  },
  async update(id: string, values: Record<string, unknown>) {
    if (!usersStore[id]) return undefined;
    const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    usersStore[id] = { ...usersStore[id], ...patch };
    return usersStore[id];
  },
  async remove(id: string) {
    const existing = usersStore[id];
    delete usersStore[id];
    return existing;
  },
};

const fakeRoles = {
  async get(id: string) {
    return id === "r1" ? { id: "r1", name: "Admin", isAdmin: true, deviceIds: [] } : undefined;
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

beforeEach(() => {
  nextId = 1;
  usersStore = {
    u0: {
      id: "u0",
      username: "existing",
      passwordHash: "hash0",
      roleId: "r1",
      displayName: "Existing",
      enabled: true,
    },
  };
});

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...usersRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("users CRUD", () => {
  test("GET /users lists users without passwordHash", async () => {
    const { status, body } = await req("GET", "/api/v1/users");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].passwordHash).toBeUndefined();
  });

  test("POST creates a user with a hashed password", async () => {
    const { status, body } = await req("POST", "/api/v1/users", {
      username: "newbie",
      password: "secret123",
      roleId: "r1",
    });
    expect(status).toBe(201);
    expect(body.username).toBe("newbie");
    expect(body.passwordHash).toBeUndefined();
    const stored = usersStore[body.id];
    expect(stored!.passwordHash).not.toBe("secret123");
    expect(await Bun.password.verify("secret123", stored!.passwordHash as string)).toBe(true);
  });

  test("POST rejects a too-short password with 400", async () => {
    const { status } = await req("POST", "/api/v1/users", { username: "x", password: "abc", roleId: "r1" });
    expect(status).toBe(400);
  });

  test("POST rejects an unknown roleId with 400", async () => {
    const { status } = await req("POST", "/api/v1/users", {
      username: "x",
      password: "secret123",
      roleId: "ghost",
    });
    expect(status).toBe(400);
  });

  test("POST rejects a duplicate username with 409", async () => {
    const { status } = await req("POST", "/api/v1/users", {
      username: "existing",
      password: "secret123",
      roleId: "r1",
    });
    expect(status).toBe(409);
  });

  test("POST requires username/password/roleId", async () => {
    expect((await req("POST", "/api/v1/users", { username: "x" })).status).toBe(400);
  });

  test("GET /:id 404s for unknown, 200 for known", async () => {
    expect((await req("GET", "/api/v1/users/ghost")).status).toBe(404);
    expect((await req("GET", "/api/v1/users/u0")).status).toBe(200);
  });

  test("PUT updates fields and only re-hashes the password when provided", async () => {
    const { status, body } = await req("PUT", "/api/v1/users/u0", { displayName: "Updated" });
    expect(status).toBe(200);
    expect(body.displayName).toBe("Updated");
    expect(usersStore.u0!.passwordHash).toBe("hash0"); // untouched

    await req("PUT", "/api/v1/users/u0", { password: "newpass123" });
    expect(usersStore.u0!.passwordHash).not.toBe("hash0");
  });

  test("PUT rejects an unknown roleId with 400", async () => {
    const { status } = await req("PUT", "/api/v1/users/u0", { roleId: "ghost" });
    expect(status).toBe(400);
  });

  test("PUT on unknown id → 404", async () => {
    expect((await req("PUT", "/api/v1/users/ghost", { displayName: "x" })).status).toBe(404);
  });

  test("DELETE removes the user", async () => {
    expect((await req("DELETE", "/api/v1/users/u0")).status).toBe(204);
    expect((await req("GET", "/api/v1/users/u0")).status).toBe(404);
  });

  test("DELETE on unknown id → 404", async () => {
    expect((await req("DELETE", "/api/v1/users/ghost")).status).toBe(404);
  });
});

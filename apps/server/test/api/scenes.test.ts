/**
 * Scenes routes tests — hermetic (no DB).
 *
 * Mounts the real route map on an ephemeral Bun.serve with fake repos and a fake
 * SceneEngine injected via ApiContext, then drives it over HTTP. Verifies request
 * shaping, action parsing/validation, and the SceneEngine error → HTTP mapping
 * (404 / 409 / 400).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { scenesRoutes } from "../../src/api/routes/scenes.ts";
import type { ApiContext } from "../../src/api/context.ts";
import {
  SceneConflictError,
  SceneNotFoundError,
  SceneValidationError,
} from "../../src/core/SceneEngine.ts";

let lastCreate: Record<string, unknown> | null = null;
let lastListFilter: Record<string, unknown> | null = null;

const fakeScenes = {
  async list(filter: Record<string, unknown>) {
    lastListFilter = filter;
    return [{ id: "s1", name: "Scene 1" }];
  },
  async get(id: string) {
    return id === "s1" ? { id: "s1", name: "Scene 1", actions: [] } : undefined;
  },
  async create(input: Record<string, unknown>) {
    lastCreate = input;
    return { id: "s-new", ...input };
  },
  async update(id: string, input: Record<string, unknown>) {
    return id === "s1" ? { id, ...input } : undefined;
  },
  async setFavorite(id: string, isFavorite: boolean) {
    return id === "s1" ? { id, isFavorite } : undefined;
  },
  async remove(id: string) {
    return id === "s1" ? { id } : undefined;
  },
};

const fakeExecutions = {
  async listByScene(sceneId: string) {
    return [{ id: "exec-1", sceneId, status: "completed" }];
  },
};

// Configurable SceneEngine fake.
const engineBehavior = {
  start: async (sceneId: string) => ({ executionId: "e1", sceneId, status: "running" as const }),
  dry: async (sceneId: string) => ({ sceneId, dryRun: true as const, groups: 1, actions: [] }),
};
const fakeEngine = {
  startScene: (sceneId: string) => engineBehavior.start(sceneId),
  dryRun: (sceneId: string) => engineBehavior.dry(sceneId),
};

const ctx = {
  scenes: fakeScenes,
  sceneExecutions: fakeExecutions,
  sceneEngine: fakeEngine,
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
  server = Bun.serve({ port: 0, routes: { ...scenesRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("scenes CRUD", () => {
  test("GET /scenes passes filters through", async () => {
    const { status, body } = await req("GET", "/api/v1/scenes?room_id=r1&is_favorite=true&tags=a,b");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(lastListFilter).toMatchObject({ roomId: "r1", isFavorite: true, tags: ["a", "b"] });
  });

  test("POST /scenes creates with parsed actions", async () => {
    const { status, body } = await req("POST", "/api/v1/scenes", {
      name: "My Scene",
      actions: [{ deviceId: "d1", command: "on" }, { deviceId: "d2", command: "setLevel", params: { level: 0.5 }, parallelGroup: 1 }],
    });
    expect(status).toBe(201);
    expect(body.id).toBe("s-new");
    expect((lastCreate!.actions as unknown[])).toHaveLength(2);
    expect((lastCreate!.actions as Array<Record<string, unknown>>)[1]).toMatchObject({
      deviceId: "d2",
      command: "setLevel",
      parallelGroup: 1,
    });
  });

  test("POST /scenes rejects malformed actions with 400", async () => {
    const { status, body } = await req("POST", "/api/v1/scenes", {
      name: "Bad",
      actions: [{ command: "on" }], // missing deviceId
    });
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });

  test("POST /scenes requires a name", async () => {
    const { status } = await req("POST", "/api/v1/scenes", { actions: [] });
    expect(status).toBe(400);
  });

  test("GET /scenes/:id returns 404 for unknown", async () => {
    expect((await req("GET", "/api/v1/scenes/nope")).status).toBe(404);
    expect((await req("GET", "/api/v1/scenes/s1")).status).toBe(200);
  });

  test("DELETE /scenes/:id → 204, unknown → 404", async () => {
    expect((await req("DELETE", "/api/v1/scenes/s1")).status).toBe(204);
    expect((await req("DELETE", "/api/v1/scenes/nope")).status).toBe(404);
  });

  test("PATCH favorite accepts is_favorite", async () => {
    const { status, body } = await req("PATCH", "/api/v1/scenes/s1/favorite", { is_favorite: true });
    expect(status).toBe(200);
    expect(body.isFavorite).toBe(true);
  });
});

describe("scene execution", () => {
  test("POST /execute returns 202 + running", async () => {
    const { status, body } = await req("POST", "/api/v1/scenes/s1/execute", { source: "test" });
    expect(status).toBe(202);
    expect(body).toMatchObject({ executionId: "e1", sceneId: "s1", status: "running" });
  });

  test("POST /execute maps SceneNotFoundError → 404", async () => {
    engineBehavior.start = async (sceneId) => { throw new SceneNotFoundError(sceneId); };
    expect((await req("POST", "/api/v1/scenes/x/execute", {})).status).toBe(404);
  });

  test("POST /execute maps SceneConflictError → 409", async () => {
    engineBehavior.start = async (sceneId) => { throw new SceneConflictError(sceneId); };
    const { status, body } = await req("POST", "/api/v1/scenes/s1/execute", {});
    expect(status).toBe(409);
    expect(body.code).toBe("CONFLICT");
  });

  test("POST /execute/dry-run maps SceneValidationError → 400", async () => {
    engineBehavior.dry = async () => { throw new SceneValidationError("missing device"); };
    expect((await req("POST", "/api/v1/scenes/s1/execute/dry-run")).status).toBe(400);
  });

  test("GET /executions lists run history", async () => {
    const { status, body } = await req("GET", "/api/v1/scenes/s1/executions");
    expect(status).toBe(200);
    expect(body[0]).toMatchObject({ id: "exec-1", status: "completed" });
  });
});

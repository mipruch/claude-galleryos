/**
 * Mapping routes tests — hermetic (no DB).
 *
 * Mounts the real route map on an ephemeral Bun.serve with a fake repo and a
 * fake InputMapper injected via ApiContext, then drives it over HTTP. A mapping
 * is purely "when" (protocol + pattern) — no target fields — so these tests
 * cover CRUD, the toggle, the dry-run `/test` matcher, and that every mutation
 * reloads the live mapper cache. Target wiring lives in `trigger-actions.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mappingsRoutes } from "../../src/api/routes/mappings.ts";
import type { ApiContext } from "../../src/api/context.ts";

let reloadCount = 0;
let lastCreate: Record<string, unknown> | null = null;
let lastListFilter: Record<string, unknown> | null = null;

const row = {
  id: "m1",
  name: "Run welcome",
  protocol: "tcp",
  pattern: "/scene/execute",
  enabled: true,
  position: null,
};

const fakeMappings = {
  async list(filter: Record<string, unknown>) {
    lastListFilter = filter;
    return [row];
  },
  async get(id: string) {
    return id === "m1" ? { ...row } : undefined;
  },
  async create(values: Record<string, unknown>) {
    lastCreate = values;
    return { id: "m-new", ...values };
  },
  async update(id: string, values: Record<string, unknown>) {
    return id === "m1" ? { ...row, ...values } : undefined;
  },
  async remove(id: string) {
    return id === "m1" ? { ...row } : undefined;
  },
  async setEnabled(id: string, enabled: boolean) {
    return id === "m1" ? { ...row, enabled } : undefined;
  },
};

// Fake InputMapper: counts reloads and runs a tiny matcher for /test.
const fakeMapper = {
  reload: async () => void reloadCount++,
  match: (signal: { protocol: string; address: string; args?: unknown[] }) =>
    signal.protocol === "tcp" && signal.address === "/scene/execute"
      ? [{ mapping: row, pathParams: {} }]
      : [],
};

const ctx = {
  mappings: fakeMappings,
  inputMapper: fakeMapper,
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
  server = Bun.serve({ port: 0, routes: { ...mappingsRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));
beforeEach(() => {
  reloadCount = 0;
  lastCreate = null;
  lastListFilter = null;
});

describe("mappings CRUD", () => {
  test("GET /mappings passes protocol+enabled filters through", async () => {
    const { status, body } = await req("GET", "/api/v1/mappings?protocol=tcp&enabled=true");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(lastListFilter).toEqual({ protocol: "tcp", enabled: true });
  });

  test("GET /mappings rejects an unknown protocol filter", async () => {
    expect((await req("GET", "/api/v1/mappings?protocol=carrier-pigeon")).status).toBe(400);
  });

  test("POST creates a mapping and reloads the cache", async () => {
    const { status, body } = await req("POST", "/api/v1/mappings", {
      name: "Run welcome",
      protocol: "tcp",
      pattern: "/scene/execute",
    });
    expect(status).toBe(201);
    expect(body.id).toBe("m-new");
    expect(lastCreate).toMatchObject({ name: "Run welcome", protocol: "tcp", pattern: "/scene/execute" });
    expect(reloadCount).toBe(1);
  });

  test("POST requires name/protocol/pattern", async () => {
    expect((await req("POST", "/api/v1/mappings", { name: "x" })).status).toBe(400);
  });

  test("POST rejects an unknown protocol", async () => {
    const { status } = await req("POST", "/api/v1/mappings", {
      name: "Bad",
      protocol: "carrier-pigeon",
      pattern: "/x",
    });
    expect(status).toBe(400);
  });

  test("GET /mappings/:id → 404 for unknown", async () => {
    expect((await req("GET", "/api/v1/mappings/nope")).status).toBe(404);
    expect((await req("GET", "/api/v1/mappings/m1")).status).toBe(200);
  });

  test("PUT updates and reloads; unknown → 404", async () => {
    const ok = await req("PUT", "/api/v1/mappings/m1", { name: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Renamed");
    expect(reloadCount).toBe(1);
    expect((await req("PUT", "/api/v1/mappings/nope", { name: "x" })).status).toBe(404);
  });

  test("DELETE → 204 + reload, unknown → 404", async () => {
    expect((await req("DELETE", "/api/v1/mappings/m1")).status).toBe(204);
    expect(reloadCount).toBe(1);
    expect((await req("DELETE", "/api/v1/mappings/nope")).status).toBe(404);
  });

  test("PATCH toggle flips when body is empty", async () => {
    const { status, body } = await req("PATCH", "/api/v1/mappings/m1/toggle");
    expect(status).toBe(200);
    expect(body.enabled).toBe(false); // row.enabled was true
    expect(reloadCount).toBe(1);
  });

  test("PATCH toggle honours an explicit enabled", async () => {
    const { body } = await req("PATCH", "/api/v1/mappings/m1/toggle", { enabled: true });
    expect(body.enabled).toBe(true);
  });
});

describe("POST /mappings/test (dry-run)", () => {
  test("reports a match with captured path params", async () => {
    const { status, body } = await req("POST", "/api/v1/mappings/test", {
      protocol: "tcp",
      address: "/scene/execute",
    });
    expect(status).toBe(200);
    expect(body.matched).toBe(true);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ id: "m1", name: "Run welcome", pathParams: {} });
  });

  test("reports no match", async () => {
    const { body } = await req("POST", "/api/v1/mappings/test", { protocol: "tcp", address: "/nope" });
    expect(body.matched).toBe(false);
    expect(body.matches).toEqual([]);
  });

  test("requires protocol + address", async () => {
    expect((await req("POST", "/api/v1/mappings/test", { protocol: "tcp" })).status).toBe(400);
  });

  test("rejects non-array args", async () => {
    const { status } = await req("POST", "/api/v1/mappings/test", {
      protocol: "tcp",
      address: "/x",
      args: "nope",
    });
    expect(status).toBe(400);
  });
});

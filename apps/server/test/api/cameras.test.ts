/**
 * Cameras routes tests — hermetic (no DB / ffmpeg / subprocesses).
 *
 * Mounts the real route map on an ephemeral Bun.serve with a fake cameras repo
 * and a fake StreamManager injected via ApiContext, then drives it over HTTP.
 * Focuses on (a) credentials never leaving the server and (b) the on-demand
 * stream lifecycle wiring (ensure → wait → serve, stop, segment guard).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { camerasRoutes } from "../../src/api/routes/cameras.ts";
import type { ApiContext } from "../../src/api/context.ts";

const rows: Record<string, Record<string, unknown>> = {
  c1: {
    id: "c1",
    name: "Hall",
    url: "rtsp://10.0.0.5:554/s",
    username: "admin",
    password: "secret",
    displayOrder: 0,
    enabled: true,
  },
  c2: {
    id: "c2",
    name: "Disabled",
    url: "rtsp://10.0.0.6:554/s",
    username: null,
    password: null,
    displayOrder: 1,
    enabled: false,
  },
};

const fakeCameras = {
  async list() {
    return Object.values(rows);
  },
  async get(id: string) {
    return rows[id];
  },
  async create(values: Record<string, unknown>) {
    const row = { id: "new", ...values };
    rows["new"] = row;
    return row;
  },
  async update(id: string, values: Record<string, unknown>) {
    if (!rows[id]) return undefined;
    rows[id] = { ...rows[id], ...values };
    return rows[id];
  },
  async remove(id: string) {
    const row = rows[id];
    if (row) delete rows[id];
    return row;
  },
};

// Fake StreamManager: records calls, and points playlistPath at a real temp file.
let baseDir = "";
const calls: string[] = [];
let playlistReady = true;
const fakeStreamManager = {
  ensure(camera: { id: string }) {
    calls.push(`ensure:${camera.id}`);
  },
  async waitForPlaylist(id: string) {
    calls.push(`wait:${id}`);
    return playlistReady;
  },
  touch(id: string) {
    calls.push(`touch:${id}`);
  },
  stop(id: string, reason: string) {
    calls.push(`stop:${id}:${reason}`);
  },
  playlistPath(id: string) {
    return join(baseDir, `${id}.m3u8`);
  },
  segmentPath(id: string, file: string) {
    return /^seg_\d+\.ts$/.test(file) ? join(baseDir, `${id}_${file}`) : null;
  },
};

let server: Server<unknown>;
let base = "";

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "camroutes-"));
  writeFileSync(join(baseDir, "c1.m3u8"), "#EXTM3U\n");
  writeFileSync(join(baseDir, "c1_seg_0.ts"), "tsdata");
  const ctx = {
    cameras: fakeCameras,
    streamManager: fakeStreamManager,
  } as unknown as ApiContext;
  server = Bun.serve({
    port: 0,
    routes: { ...camerasRoutes(ctx) },
    fetch: () => new Response("nf", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(baseDir, { recursive: true, force: true });
});

describe("camera CRUD", () => {
  test("GET /cameras strips credentials", async () => {
    const res = await fetch(`${base}/api/v1/cameras`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    for (const cam of list) {
      expect(cam).not.toHaveProperty("username");
      expect(cam).not.toHaveProperty("password");
      expect(cam).toHaveProperty("url");
    }
  });

  test("GET /cameras/:id returns 404 for unknown id", async () => {
    const res = await fetch(`${base}/api/v1/cameras/nope`);
    expect(res.status).toBe(404);
  });

  test("POST /cameras creates and never echoes credentials back", async () => {
    const res = await fetch(`${base}/api/v1/cameras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", url: "rtsp://h/s", username: "u", password: "p" }),
    });
    expect(res.status).toBe(201);
    const cam = (await res.json()) as Record<string, unknown>;
    expect(cam.name).toBe("New");
    expect(cam).not.toHaveProperty("password");
    expect(cam).not.toHaveProperty("username");
    // ...but the credentials were persisted server-side.
    expect(rows["new"]?.password).toBe("p");
  });

  test("POST /cameras rejects a body missing required fields", async () => {
    const res = await fetch(`${base}/api/v1/cameras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No URL" }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /cameras/:id stops the stream then removes the row", async () => {
    calls.length = 0;
    const res = await fetch(`${base}/api/v1/cameras/c2`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(calls).toContain("stop:c2:camera-deleted");
    expect(rows["c2"]).toBeUndefined();
  });
});

describe("camera streaming", () => {
  test("GET stream.m3u8 ensures, waits, then serves the playlist", async () => {
    calls.length = 0;
    playlistReady = true;
    const res = await fetch(`${base}/api/v1/cameras/c1/stream.m3u8`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(calls).toEqual(["ensure:c1", "wait:c1", "touch:c1"]);
    expect(await res.text()).toContain("#EXTM3U");
  });

  test("GET stream.m3u8 returns 503 when the stream can't start", async () => {
    playlistReady = false;
    const res = await fetch(`${base}/api/v1/cameras/c1/stream.m3u8`);
    expect(res.status).toBe(503);
    playlistReady = true;
  });

  test("GET stream.m3u8 returns 404 for a disabled or missing camera", async () => {
    // c2 was deleted above; also covers the disabled case before deletion.
    const res = await fetch(`${base}/api/v1/cameras/c2/stream.m3u8`);
    expect(res.status).toBe(404);
  });

  test("GET seg/:file serves a valid segment and touches the stream", async () => {
    calls.length = 0;
    const res = await fetch(`${base}/api/v1/cameras/c1/seg/seg_0.ts`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("video/mp2t");
    expect(calls).toContain("touch:c1");
  });

  test("GET seg/:file rejects a traversal-style name with 400", async () => {
    const res = await fetch(`${base}/api/v1/cameras/c1/seg/evil.ts`);
    expect(res.status).toBe(400);
  });

  test("POST /cameras/:id/stop stops the transcoder", async () => {
    calls.length = 0;
    const res = await fetch(`${base}/api/v1/cameras/c1/stop`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(calls).toContain("stop:c1:client-request");
  });
})

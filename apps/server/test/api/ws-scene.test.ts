/**
 * WebSocket scene:execute tests — hermetic (no DB / engine).
 *
 * Spins up a real Bun.serve with the WS handlers and a fake ApiContext (fake
 * scenes repo + real EventBus). A real WebSocket client sends `scene:execute`;
 * we assert the ack and that the handler emits `scene.execute.requested` on the
 * bus (which the SceneEngine subscribes to in production).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { makeWebSocketHandlers } from "../../src/api/ws.ts";
import { EventBus, type GalleryEvent } from "../../src/core/EventBus.ts";
import type { ApiContext } from "../../src/api/context.ts";

const bus = new EventBus();
const ctx = {
  eventBus: bus,
  scenes: {
    async get(id: string) {
      return id === "s1" ? { id: "s1", name: "Scene 1", actions: [] } : undefined;
    },
  },
  meterService: { disconnect() {} },
} as unknown as ApiContext;

let server: Server<unknown>;
let url: string;

/** Open a WS client and collect parsed messages; resolves once `open` fires. */
function connect(): Promise<{
  ws: WebSocket;
  messages: Array<{ event: string; data: Record<string, unknown> }>;
  next: (event: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}> {
  const ws = new WebSocket(url);
  const messages: Array<{ event: string; data: Record<string, unknown> }> = [];
  const waiters: Array<{ event: string; resolve: (d: Record<string, unknown>) => void }> = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    messages.push(msg);
    const idx = waiters.findIndex((w) => w.event === msg.event);
    if (idx !== -1) waiters.splice(idx, 1)[0]!.resolve(msg.data);
  });

  const next = (event: string, timeoutMs = 1000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const found = messages.find((m) => m.event === event);
      if (found) return resolve(found.data);
      waiters.push({ event, resolve });
      setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    });

  return new Promise((resolve) => {
    ws.addEventListener("open", () => resolve({ ws, messages, next }));
  });
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: {} })) return undefined;
      return new Response("upgrade failed", { status: 426 });
    },
    websocket: makeWebSocketHandlers(ctx),
  });
  url = `ws://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("ws scene:execute", () => {
  test("acks with an executionId and emits scene.execute.requested", async () => {
    const { ws, next } = await connect();
    await next("hello");

    const requested = new Promise<GalleryEvent>((resolve) =>
      bus.once("scene.execute.requested", resolve),
    );

    ws.send(JSON.stringify({ event: "scene:execute", data: { sceneId: "s1", source: "tablet" } }));

    const ack = await next("scene:execute:ack");
    expect(ack.sceneId).toBe("s1");
    expect(ack.executionId).toBeTruthy();
    expect(ack.status).toBe("requested");

    const ev = (await requested) as Extract<GalleryEvent, { type: "scene.execute.requested" }>;
    expect(ev.sceneId).toBe("s1");
    expect(ev.source).toBe("tablet");
    expect(ev.executionId).toBe(String(ack.executionId)); // ack id matches the emitted event
    ws.close();
  });

  test("acks with an error for an unknown scene (no event emitted)", async () => {
    const { ws, next } = await connect();
    await next("hello");

    let emitted = false;
    const off = bus.on("scene.execute.requested", () => { emitted = true; });

    ws.send(JSON.stringify({ event: "scene:execute", data: { sceneId: "ghost" } }));
    const ack = await next("scene:execute:ack");
    expect(ack.error).toBe("scene not found");
    expect(ack.sceneId).toBe("ghost");
    expect(emitted).toBe(false);
    off();
    ws.close();
  });
});

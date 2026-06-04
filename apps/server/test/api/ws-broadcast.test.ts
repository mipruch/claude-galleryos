/**
 * WebSocket broadcast de-duplication tests — hermetic (no DB / drivers).
 *
 * Spins up a real Bun.serve with the WS handlers + broadcast bridge and a real
 * EventBus. A single user action typically emits two identical
 * `device.state.changed` events (the optimistic "command" result and the
 * driver's own "echo"); the UI should only receive the change once. We assert
 * that an identical second change is suppressed, while a genuinely different
 * state — and non-state events — still pass through.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { makeWebSocketHandlers, setupBroadcast } from "../../src/api/ws.ts";
import { EventBus } from "../../src/core/EventBus.ts";
import type { ApiContext } from "../../src/api/context.ts";

const bus = new EventBus();
const ctx = { eventBus: bus } as unknown as ApiContext;

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

/** Resolve after a short tick so any pending broadcast has been delivered. */
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: {} })) return undefined;
      return new Response("upgrade failed", { status: 426 });
    },
    websocket: makeWebSocketHandlers(ctx),
  });
  setupBroadcast(server, ctx);
  url = `ws://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

describe("ws device:state broadcast de-duplication", () => {
  test("identical state changes are sent to the UI only once", async () => {
    const { ws, messages } = await connect();
    await settle(); // consume "hello"

    // Same action, two sources: command result + driver echo.
    bus.emit({ type: "device.state.changed", deviceId: "d1", state: { power: "on" }, source: "command" });
    bus.emit({ type: "device.state.changed", deviceId: "d1", state: { power: "on" }, source: "echo" });
    await settle();

    const stateMsgs = messages.filter((m) => m.event === "device:state" && m.data.deviceId === "d1");
    expect(stateMsgs).toHaveLength(1);
    expect(stateMsgs[0]!.data.state).toEqual({ power: "on" });
    ws.close();
  });

  test("a genuinely different state still passes through", async () => {
    const { ws, messages } = await connect();
    await settle();

    bus.emit({ type: "device.state.changed", deviceId: "d2", state: { power: "on" }, source: "command" });
    bus.emit({ type: "device.state.changed", deviceId: "d2", state: { power: "on" }, source: "echo" }); // dup
    bus.emit({ type: "device.state.changed", deviceId: "d2", state: { power: "off" }, source: "echo" }); // change
    await settle();

    const stateMsgs = messages.filter((m) => m.event === "device:state" && m.data.deviceId === "d2");
    expect(stateMsgs).toHaveLength(2);
    expect(stateMsgs.map((m) => m.data.state)).toEqual([{ power: "on" }, { power: "off" }]);
    ws.close();
  });

  test("de-duplication is per device", async () => {
    const { ws, messages } = await connect();
    await settle();

    bus.emit({ type: "device.state.changed", deviceId: "a", state: { power: "on" }, source: "command" });
    bus.emit({ type: "device.state.changed", deviceId: "b", state: { power: "on" }, source: "command" });
    await settle();

    expect(messages.filter((m) => m.event === "device:state" && m.data.deviceId === "a")).toHaveLength(1);
    expect(messages.filter((m) => m.event === "device:state" && m.data.deviceId === "b")).toHaveLength(1);
    ws.close();
  });

  test("non-state events are never de-duplicated", async () => {
    const { ws, messages } = await connect();
    await settle();

    bus.emit({ type: "device.online", deviceId: "d3", connectionId: "c1" });
    bus.emit({ type: "device.online", deviceId: "d3", connectionId: "c1" });
    await settle();

    expect(messages.filter((m) => m.event === "device:online" && m.data.deviceId === "d3")).toHaveLength(2);
    ws.close();
  });
});

/**
 * WebSocket device:command ack-contract tests — hermetic (fake DeviceManager).
 *
 * Asserts the origin always receives a `device:command:ack` carrying an explicit
 * `success` boolean, so the UI can uniformly decide stay-vs-revert:
 *   - success           → { success: true, ...state }
 *   - returned failure  → { success: false, error }
 *   - thrown exception  → { success: false, error }
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { makeWebSocketHandlers } from "../../src/api/ws.ts";
import type { ApiContext } from "../../src/api/context.ts";
import type { CommandResult } from "@gallery/driver-core";

/** Fake DeviceManager.execute keyed by command name. */
const ctx = {
  deviceManager: {
    async execute(_deviceId: string, command: string): Promise<CommandResult> {
      if (command === "boom") throw new Error("driver exploded");
      if (command === "reject") return { success: false, durationMs: 1, error: "device refused" };
      return { success: true, durationMs: 2, state: { power: "on" } };
    },
  },
} as unknown as ApiContext;

let server: Server<unknown>;
let url: string;

function connect(): Promise<{
  ws: WebSocket;
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
  return new Promise((resolve) => ws.addEventListener("open", () => resolve({ ws, next })));
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

describe("ws device:command ack contract", () => {
  test("success → ack { success: true, state }", async () => {
    const { ws, next } = await connect();
    await next("hello");
    ws.send(JSON.stringify({ event: "device:command", data: { deviceId: "d1", command: "on" } }));
    const ack = await next("device:command:ack");
    expect(ack.deviceId).toBe("d1");
    expect(ack.success).toBe(true);
    expect(ack.state).toEqual({ power: "on" });
    ws.close();
  });

  test("returned failure → ack { success: false, error }", async () => {
    const { ws, next } = await connect();
    await next("hello");
    ws.send(JSON.stringify({ event: "device:command", data: { deviceId: "d1", command: "reject" } }));
    const ack = await next("device:command:ack");
    expect(ack.success).toBe(false);
    expect(ack.error).toBe("device refused");
    ws.close();
  });

  test("thrown exception → ack { success: false, error }", async () => {
    const { ws, next } = await connect();
    await next("hello");
    ws.send(JSON.stringify({ event: "device:command", data: { deviceId: "d1", command: "boom" } }));
    const ack = await next("device:command:ack");
    expect(ack.success).toBe(false);
    expect(ack.error).toBe("driver exploded");
    ws.close();
  });
});

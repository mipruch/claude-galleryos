/**
 * WebSocket layer (native Bun.serve, no socket.io).
 *
 * Every client is subscribed to the `events` topic on connect and receives a
 * broadcast of all relevant state changes. Messages use a JSON envelope:
 *   server → client: { event: "device:state", data: {...} }
 *   client → server: { event: "device:command", data: { deviceId, command, params } }
 *
 * Broadcasting uses Bun's built-in pub/sub (`server.publish` / `ws.subscribe`).
 */

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { GalleryEvent } from "../core/EventBus.ts";
import type { ApiContext } from "./context.ts";
import { logger } from "../logger.ts";

const log = logger.child("ws");
const BROADCAST_TOPIC = "events";

const envelope = (event: string, data: unknown): string => JSON.stringify({ event, data });

/** Translate an internal event into a client-facing message (or drop it). */
export function toClientMessage(e: GalleryEvent): { event: string; data: unknown } | null {
  switch (e.type) {
    case "device.state.changed":
      return {
        event: "device:state",
        data: { deviceId: e.deviceId, state: e.state, source: e.source, timestamp: new Date().toISOString() },
      };
    case "device.online":
      return { event: "device:online", data: { deviceId: e.deviceId } };
    case "device.offline":
      return { event: "device:offline", data: { deviceId: e.deviceId, reason: e.reason } };
    case "connection.connected":
      return { event: "connection:connected", data: { connectionId: e.connectionId } };
    case "connection.disconnected":
      return { event: "connection:disconnected", data: { connectionId: e.connectionId, reason: e.reason } };
    case "connection.error":
      return { event: "driver:error", data: { connectionId: e.connectionId, message: e.error } };
    case "scene.execute.started":
      return { event: "scene:started", data: { sceneId: e.sceneId, executionId: e.executionId } };
    case "scene.execute.completed":
      return { event: "scene:completed", data: { sceneId: e.sceneId, executionId: e.executionId, durationMs: e.durationMs } };
    case "scene.execute.failed":
      return { event: "scene:failed", data: { sceneId: e.sceneId, executionId: e.executionId, error: e.error } };
    case "system.driver.crashed":
      return { event: "driver:error", data: { connectionId: e.connectionId, driverId: e.driverId, message: e.error } };
    default:
      return null;
  }
}

/** Build the Bun WebSocket handlers, closing over the API context. */
export function makeWebSocketHandlers(ctx: ApiContext): WebSocketHandler<unknown> {
  return {
    open(ws) {
      ws.subscribe(BROADCAST_TOPIC);
      log.info("client connected", { remoteAddress: ws.remoteAddress });
      ws.send(envelope("hello", { message: "GalleryOS realtime" }));
    },
    close(ws, code, reason) {
      ws.unsubscribe(BROADCAST_TOPIC);
      log.info("client disconnected", { remoteAddress: ws.remoteAddress, code, reason });
    },
    async message(ws, raw) {
      let msg: { event?: string; data?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        log.warn("invalid message (not JSON)");
        ws.send(envelope("error", { message: "invalid JSON" }));
        return;
      }
      log.info("message", { event: msg.event, data: msg.data });
      await dispatch(ws, ctx, msg.event ?? "", msg.data ?? {});
    },
  };
}

// ── per-event handlers ────────────────────────────────────────────────────────

type WsData = Record<string, unknown>;
type Handler = (ws: ServerWebSocket<unknown>, ctx: ApiContext, data: WsData) => Promise<void>;

/** Route client messages to their handlers. Unknown events get an error reply. */
async function dispatch(
  ws: ServerWebSocket<unknown>,
  ctx: ApiContext,
  event: string,
  data: WsData,
): Promise<void> {
  const handler = CLIENT_HANDLERS[event];
  if (handler) return handler(ws, ctx, data);
  ws.send(envelope("error", { message: `unknown event: ${event || "(none)"}` }));
}

/** Guard: data carries a non-empty deviceId and a non-empty state patch. */
function isStatePatch(d: WsData): d is { deviceId: string; state: Record<string, unknown> } {
  const patch = d.state as Record<string, unknown> | undefined;
  return !!d.deviceId && !!patch && Object.keys(patch).length > 0;
}

/**
 * Persist a UI-originated state patch in Redis and broadcast to all clients
 * without executing a driver command. Used to store "desired" values
 * (e.g. brightness while a light is off) so all UIs stay in sync.
 */
async function onStatePatch(
  _ws: ServerWebSocket<unknown>,
  ctx: ApiContext,
  data: WsData,
): Promise<void> {
  if (!isStatePatch(data)) return;
  const { deviceId, state: patch } = data;
  await ctx.state.setDeviceState(deviceId, patch);
  const stored = await ctx.state.getDeviceState(deviceId);
  ctx.eventBus.emit({ type: "device.state.changed", deviceId, state: stored ?? patch, source: "ui" });
}

async function onDeviceCommand(
  ws: ServerWebSocket<unknown>,
  ctx: ApiContext,
  data: WsData,
): Promise<void> {
  const deviceId = String(data.deviceId ?? "");
  // Use Object.assign to default params without an extra ?? branch.
  const params = Object.assign({}, data.params as Record<string, unknown>);
  try {
    const result = await ctx.deviceManager.execute(deviceId, String(data.command ?? ""), params);
    ws.send(envelope("device:command:ack", { deviceId, ...result }));
  } catch (err) {
    ws.send(envelope("device:command:ack", { deviceId, error: errMsg(err) }));
  }
}

async function onSubscribe(
  ws: ServerWebSocket<unknown>,
  _ctx: ApiContext,
  data: WsData,
): Promise<void> {
  ws.subscribe(`device:${String(data.deviceId ?? "")}`);
}

async function onUnsubscribe(
  ws: ServerWebSocket<unknown>,
  _ctx: ApiContext,
  data: WsData,
): Promise<void> {
  ws.unsubscribe(`device:${String(data.deviceId ?? "")}`);
}

async function onSceneExecute(
  ws: ServerWebSocket<unknown>,
  ctx: ApiContext,
  data: WsData,
): Promise<void> {
  const sceneId = String(data.sceneId ?? "");
  if (!sceneId) {
    ws.send(envelope("scene:execute:ack", { error: "sceneId required" }));
    return;
  }
  const scene = await ctx.scenes.get(sceneId);
  if (!scene) {
    ws.send(envelope("scene:execute:ack", { sceneId, error: "scene not found" }));
    return;
  }
  const executionId = crypto.randomUUID();
  const source = data.source ? String(data.source) : "websocket";
  ctx.eventBus.emit({ type: "scene.execute.requested", sceneId, source, executionId });
  ws.send(envelope("scene:execute:ack", { sceneId, executionId, status: "requested" }));
}

const CLIENT_HANDLERS: Record<string, Handler> = {
  "device:state:patch": onStatePatch,
  "device:command": onDeviceCommand,
  "device:subscribe": onSubscribe,
  "device:unsubscribe": onUnsubscribe,
  "scene:execute": onSceneExecute,
};

// ── broadcast bridge ──────────────────────────────────────────────────────────

/** Subscribe to the EventBus and broadcast mapped events to all clients. */
export function setupBroadcast(server: Server<unknown>, ctx: ApiContext): void {
  ctx.eventBus.onAny((event) => {
    const message = toClientMessage(event);
    if (!message) {
      log.debug("broadcast skipped (no client mapping)", { type: event.type });
      return;
    }
    const recipients = server.publish(BROADCAST_TOPIC, envelope(message.event, message.data));
    log.info("broadcast →", { event: message.event, recipients, data: message.data });
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

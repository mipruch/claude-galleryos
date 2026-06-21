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
import type {
  ClientEvent,
  EventOf,
  GalleryEvent,
  GalleryEventType,
  ServerEvent,
  ServerMessage,
  ServerMessageData,
} from "@gallery/types";
import type { ApiContext } from "./context.ts";
import { errMsg } from "@gallery/driver-core";
import { logger } from "../logger.ts";

const log = logger.child("ws");
const BROADCAST_TOPIC = "events";

/** Build a typed server→client envelope. `data` is checked against the event. */
const envelope = <E extends ServerEvent>(event: E, data: ServerMessageData<E>): string =>
  JSON.stringify({ event, data });

/**
 * Project each internal event onto its wire message (or `null` to keep it
 * server-side). The mapped type makes this table exhaustive: adding a
 * `GalleryEvent` without a projection here is a compile error — no event can be
 * silently dropped.
 */
const PROJECTIONS: { [T in GalleryEventType]: (e: EventOf<T>) => ServerMessage | null } = {
  "device.state.changed": (e) => ({
    event: "device:state",
    data: { deviceId: e.deviceId, state: e.state, source: e.source, timestamp: new Date().toISOString() },
  }),
  "device.online": (e) => ({ event: "device:online", data: { deviceId: e.deviceId } }),
  "device.offline": (e) => ({ event: "device:offline", data: { deviceId: e.deviceId, reason: e.reason } }),
  "connection.connected": (e) => ({ event: "connection:connected", data: { connectionId: e.connectionId } }),
  "connection.disconnected": (e) => ({
    event: "connection:disconnected",
    data: { connectionId: e.connectionId, reason: e.reason },
  }),
  "connection.error": (e) => ({ event: "driver:error", data: { connectionId: e.connectionId, message: e.error } }),
  "scene.execute.requested": () => null,
  "scene.execute.started": (e) => ({ event: "scene:started", data: { sceneId: e.sceneId, executionId: e.executionId } }),
  "scene.execute.completed": (e) => ({
    event: "scene:completed",
    data: { sceneId: e.sceneId, executionId: e.executionId, durationMs: e.durationMs },
  }),
  "scene.execute.failed": (e) => ({
    event: "scene:failed",
    data: { sceneId: e.sceneId, executionId: e.executionId, error: e.error },
  }),
  "input.osc.received": () => null,
  "input.tcp.received": () => null,
  "system.driver.crashed": (e) => ({
    event: "driver:error",
    data: { connectionId: e.connectionId, driverId: e.driverId, message: e.error },
  }),
  "system.startup.complete": () => null,
};

/**
 * Translates an internal event into a client-facing message (or drops it).
 *
 * @returns The `ServerMessage` to broadcast to connected clients, or `null` to drop the event without forwarding.
 */
export function toClientMessage(e: GalleryEvent): ServerMessage | null {
  return (PROJECTIONS[e.type] as (ev: GalleryEvent) => ServerMessage | null)(e);
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
      log.info("message from a client received", { event: msg.event, data: msg.data });
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
  const handler = CLIENT_HANDLERS[event as ClientEvent];
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

/**
 * Executes a device command and sends the result back to the client.
 */
async function onDeviceCommand(
  ws: ServerWebSocket<unknown>,
  ctx: ApiContext,
  data: WsData,
): Promise<void> {
  const deviceId = String(data.deviceId ?? "");
  const params = { ...((data.params as Record<string, unknown>) ?? {}) };
  try {
    const result = await ctx.deviceManager.execute(deviceId, String(data.command ?? ""), params);
    ws.send(envelope("device:command:ack", { deviceId, ...result }));
  } catch (err) {
    // Mirror the failure shape of a returned CommandResult so the origin UI
    // can uniformly check `ack.success` to decide stay-vs-revert.
    ws.send(envelope("device:command:ack", { deviceId, success: false, error: errMsg(err) }));
  }
}

/**
 * Initiates execution of a scene after validating it exists.
 *
 * Sends error responses if the scene ID is missing or the scene does not exist.
 * Otherwise generates an execution ID, emits an execution request event, and sends
 * an acknowledgment with the execution details.
 */
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
  // Validate the scene exists, then trigger the run via the EventBus. The
  // SceneEngine (subscribed to `scene.execute.requested`) does the work and
  // emits scene:started / scene:completed / scene:failed, which the broadcast
  // bridge relays to all clients. We ack immediately with the executionId.
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

const CLIENT_HANDLERS: Partial<Record<ClientEvent, Handler>> = {
  "device:state:patch": onStatePatch,
  "device:command": onDeviceCommand,
  "scene:execute": onSceneExecute,
};

// ── broadcast bridge ──────────────────────────────────────────────────────────

/**
 * Subscribe to the EventBus and broadcast mapped events to all clients.
 *
 * `device:state` changes are de-duplicated by content per device: a single user
 * action usually produces two identical state changes — the optimistic
 * "command" result and the driver's own "echo" — but the UI only needs to learn
 * about the change once, regardless of where it came from. We therefore broadcast
 * a `device:state` only when the state actually differs from what was last sent
 * for that device; suppressed echoes are still logged for server-side
 * observability. All other event types (online/offline, connection, scene,
 * driver errors) always pass through.
 */
export function setupBroadcast(server: Server<unknown>, ctx: ApiContext): void {
  const lastStateByDevice = new Map<string, string>();

  ctx.eventBus.onAny((event) => {
    const message = toClientMessage(event);
    if (!message) {
      log.debug("broadcast skipped (no client mapping)", { type: event.type });
      return;
    }

    if (event.type === "device.state.changed") {
      const serialized = JSON.stringify(event.state);
      if (lastStateByDevice.get(event.deviceId) === serialized) {
        log.info("device:state echo (duplicate, not broadcast)", {
          deviceId: event.deviceId,
          source: event.source,
          state: event.state,
        });
        return;
      }
      lastStateByDevice.set(event.deviceId, serialized);
    }

    const recipients = server.publish(BROADCAST_TOPIC, JSON.stringify(message));
    log.info("broadcast →", { event: message.event, recipients, data: message.data });
  });
}

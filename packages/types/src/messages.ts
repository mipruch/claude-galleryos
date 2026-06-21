/**
 * WebSocket message contract (README §9) — shared by the server's `/ws` handler
 * and the UI stores so every realtime message stays consistent on both ends.
 *
 * Wire format is a JSON envelope `{ event, data }`. `ServerMessage` is the
 * discriminated union of everything the server broadcasts/replies; `ClientMessage`
 * is everything the UI sends back. Narrow by `event` to get a fully-typed `data`.
 *
 * Note: this is intentionally separate from the server-internal `GalleryEvent`
 * bus. The bus carries internal concerns (driver/Redis events); only the subset
 * that crosses the socket lives here, in the shape it crosses in.
 */

import type { DeviceState } from "./live.ts";

/** Generic JSON envelope every message is wrapped in. */
export interface WsEnvelope<E extends string = string, D = unknown> {
  event: E;
  data: D;
}

// ── server → client ──────────────────────────────────────────
export type ServerMessage =
  | WsEnvelope<"hello", { message: string }>
  | WsEnvelope<
      "device:state",
      { deviceId: string; state: DeviceState; source: string; timestamp: string }
    >
  | WsEnvelope<"device:online", { deviceId: string }>
  | WsEnvelope<"device:offline", { deviceId: string; reason: string }>
  | WsEnvelope<"connection:connected", { connectionId: string }>
  | WsEnvelope<"connection:disconnected", { connectionId: string; reason: string }>
  | WsEnvelope<"driver:error", { connectionId?: string; driverId?: string; message: string }>
  | WsEnvelope<"scene:started", { sceneId: string; executionId: string }>
  | WsEnvelope<"scene:completed", { sceneId: string; executionId: string; durationMs: number }>
  | WsEnvelope<"scene:failed", { sceneId: string; executionId: string; error: string }>
  | WsEnvelope<
      "device:command:ack",
      { deviceId: string; success: boolean; durationMs?: number; state?: DeviceState; error?: string }
    >
  | WsEnvelope<"scene:execute:ack", SceneExecuteAck>
  | WsEnvelope<"error", { message: string }>;

/**
 * Reply to a `scene:execute` request: either the run was accepted (`status:
 * "requested"`, with the new `executionId`) or it was rejected (`error`). Split
 * into a discriminated success/error shape so consumers narrow on `error` instead
 * of probing every optional field.
 */
export type SceneExecuteAck =
  | { status: "requested"; sceneId: string; executionId: string; error?: never }
  | { error: string; sceneId?: string; status?: never; executionId?: never };

// ── client → server ──────────────────────────────────────────
export type ClientMessage =
  | WsEnvelope<
      "device:command",
      { deviceId: string; command: string; params?: Record<string, unknown> }
    >
  | WsEnvelope<"device:state:patch", { deviceId: string; state: DeviceState }>
  | WsEnvelope<"scene:execute", { sceneId: string; source?: string }>;

/** Discriminant strings. */
export type ServerEvent = ServerMessage["event"];
export type ClientEvent = ClientMessage["event"];

/** The `data` payload for a given server/client event. */
export type ServerMessageData<E extends ServerEvent> = Extract<ServerMessage, { event: E }>["data"];
export type ClientMessageData<E extends ClientEvent> = Extract<ClientMessage, { event: E }>["data"];

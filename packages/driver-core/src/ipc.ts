/**
 * IPC protocol between the core (parent) and a driver (subprocess child).
 *
 * Transport is Bun's native subprocess IPC (`Bun.spawn({ ipc })` on the parent,
 * `process.send` / `process.on("message")` on the child). Bun uses structured
 * clone serialization by default, so `Date` instances and nested objects survive
 * the boundary — no manual (de)serialization needed.
 *
 * Discriminant field is `kind` (chosen over `type` to avoid clashing with the
 * many domain objects that already carry a `type` property).
 *
 * Request/response messages carry a `requestId` (UUID) so the parent can match a
 * `reply` to the originating call. Fire-and-forget events have no requestId.
 */

import type {
  ConnectionConfig,
  DriverError,
  EndpointDescriptor,
  LogLevel,
  MeterUpdate,
  StateChangeEvent,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────
// Parent → Child
// ─────────────────────────────────────────────────────────────

export type CoreToDriverMessage =
  | { kind: "init"; config: ConnectionConfig; dryRun: boolean }
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "destroy" }
  | {
      kind: "executeCommand";
      requestId: string;
      endpoint: EndpointDescriptor;
      command: string;
      params: Record<string, unknown>;
    }
  | { kind: "readState"; requestId: string; endpoint: EndpointDescriptor }
  | { kind: "healthCheck"; requestId: string }
  | { kind: "endpointHealthCheck"; requestId: string; endpoint: EndpointDescriptor }
  | { kind: "subscribeToEndpoint"; endpoint: EndpointDescriptor }
  | { kind: "unsubscribeFromEndpoint"; endpoint: EndpointDescriptor }
  // Live meters (fire-and-forget; the core ref-counts subscribers itself).
  | { kind: "meterSubscribe"; address: Record<string, unknown> }
  | { kind: "meterUnsubscribe"; address: Record<string, unknown> }
  | { kind: "discoverEndpoints"; requestId: string }
  // Reply to a child-initiated storage.get request.
  | { kind: "storage.reply"; requestId: string; value?: unknown; error?: string };

// ─────────────────────────────────────────────────────────────
// Child → Parent
// ─────────────────────────────────────────────────────────────

export type DriverToCoreMessage =
  // Lifecycle / events (fire-and-forget)
  | { kind: "ready" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason: string }
  | { kind: "state"; event: StateChangeEvent }
  | { kind: "meter"; update: MeterUpdate }
  | { kind: "error"; error: DriverError }
  | { kind: "log"; level: LogLevel; message: string; meta?: Record<string, unknown> }
  // Response to a parent request
  | { kind: "reply"; requestId: string; result?: unknown; error?: string }
  // Driver KV storage routed through the parent (which owns Redis)
  | { kind: "storage.get"; requestId: string; key: string }
  | { kind: "storage.set"; key: string; value: unknown }
  | { kind: "storage.delete"; key: string };

/** Narrowing helper: a message is a parent request expecting a `reply`. */
export type RequestMessage = Extract<CoreToDriverMessage, { requestId: string }>;

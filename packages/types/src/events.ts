/**
 * Internal event catalog — the single source of truth for everything that flows
 * over the server's EventBus. Lives here (not in the server) so the WebSocket wire
 * projection (`messages.ts`) and any UI tooling reference the same definitions.
 *
 * Naming convention: `domain.noun.verb` (e.g. `device.state.changed`). This is
 * deliberately separate from the wire contract: only a subset crosses the socket,
 * reshaped in `api/ws.ts` (`toClientMessage`).
 */

import type { DeviceState } from "./live.ts";

/** The complete set of events flowing through the system. */
export type GalleryEvent =
  // Devices
  | { type: "device.state.changed"; deviceId: string; state: DeviceState; source: string }
  | { type: "device.online"; deviceId: string; connectionId: string }
  | { type: "device.offline"; deviceId: string; connectionId: string; reason: string }
  // Connections
  | { type: "connection.connected"; connectionId: string }
  | { type: "connection.disconnected"; connectionId: string; reason: string }
  | { type: "connection.error"; connectionId: string; error: string }
  // Scenes
  | { type: "scene.execute.requested"; sceneId: string; source: string; executionId: string }
  | { type: "scene.execute.started"; sceneId: string; executionId: string }
  | { type: "scene.execute.completed"; sceneId: string; executionId: string; durationMs: number }
  | { type: "scene.execute.failed"; sceneId: string; executionId: string; error: string }
  // Inputs (used by later steps)
  | { type: "input.osc.received"; address: string; args: unknown[] }
  | { type: "input.tcp.received"; message: string; client: string }
  // System
  | { type: "system.driver.crashed"; connectionId: string; driverId: string; error: string }
  | { type: "system.startup.complete" };

/** Discriminant string of any event. */
export type GalleryEventType = GalleryEvent["type"];

/** Narrow an event by its `type`. */
export type EventOf<T extends GalleryEventType> = Extract<GalleryEvent, { type: T }>;

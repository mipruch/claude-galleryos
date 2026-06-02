/**
 * Internal Event Bus — the spine of the architecture.
 *
 * Modules communicate exclusively through typed events rather than direct calls,
 * so they stay loosely coupled and independently testable (DeviceManager does
 * not import SceneEngine, etc.). This is a thin, fully-typed wrapper over
 * Node/Bun's EventEmitter. It is a singleton (`eventBus`).
 *
 * Event naming convention: `domain.noun.verb` (e.g. `device.state.changed`).
 */

import { EventEmitter } from "node:events";

/** The complete set of events flowing through the system. */
export type GalleryEvent =
  // Devices
  | { type: "device.state.changed"; deviceId: string; state: Record<string, unknown>; source: string }
  | { type: "device.online"; deviceId: string; connectionId: string }
  | { type: "device.offline"; deviceId: string; connectionId: string; reason: string }
  // Connections
  | { type: "connection.connected"; connectionId: string }
  | { type: "connection.disconnected"; connectionId: string; reason: string }
  | { type: "connection.error"; connectionId: string; error: string }
  // Scenes (used by later steps)
  | { type: "scene.execute.requested"; sceneId: string; source: string; executionId: string }
  | { type: "scene.execute.started"; sceneId: string; executionId: string }
  | { type: "scene.execute.completed"; sceneId: string; executionId: string; durationMs: number }
  | { type: "scene.execute.failed"; sceneId: string; executionId: string; error: string }
  | { type: "scene.execute.aborted"; sceneId: string; executionId: string }
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

const WILDCARD = "*";

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many modules subscribe to the same events; lift the default cap.
    this.emitter.setMaxListeners(100);
  }

  /** Publish an event to all subscribers (synchronous fan-out). */
  emit(event: GalleryEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit(WILDCARD, event);
  }

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GalleryEventType>(type: T, handler: (event: EventOf<T>) => void): () => void {
    this.emitter.on(type, handler as (e: GalleryEvent) => void);
    return () => this.emitter.off(type, handler as (e: GalleryEvent) => void);
  }

  /** Subscribe to one event type, once. */
  once<T extends GalleryEventType>(type: T, handler: (event: EventOf<T>) => void): void {
    this.emitter.once(type, handler as (e: GalleryEvent) => void);
  }

  /** Subscribe to every event (useful for logging/audit). */
  onAny(handler: (event: GalleryEvent) => void): () => void {
    this.emitter.on(WILDCARD, handler);
    return () => this.emitter.off(WILDCARD, handler);
  }
}

/** Singleton event bus shared across the server. */
export const eventBus = new EventBus();

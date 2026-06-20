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
import type { EventOf, GalleryEvent, GalleryEventType } from "@gallery/types";

// The event catalog is the single source of truth in `@gallery/types`; re-exported
// here so server modules can keep importing it from the bus.
export type { EventOf, GalleryEvent, GalleryEventType } from "@gallery/types";

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

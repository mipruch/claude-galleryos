import { EventEmitter } from 'events';

export type GalleryEvent =
  | { type: 'device.state.changed'; deviceId: string; state: Record<string, unknown>; source: string }
  | { type: 'device.online'; deviceId: string; connectionId: string }
  | { type: 'device.offline'; deviceId: string; connectionId: string; reason: string }
  | { type: 'connection.connected'; connectionId: string }
  | { type: 'connection.disconnected'; connectionId: string; reason: string }
  | { type: 'connection.error'; connectionId: string; error: string }
  | { type: 'scene.execute.requested'; sceneId: string; source: string; executionId: string }
  | { type: 'scene.execute.started'; sceneId: string; executionId: string; source: string }
  | { type: 'scene.execute.completed'; sceneId: string; executionId: string; durationMs: number }
  | { type: 'scene.execute.failed'; sceneId: string; executionId: string; error: string }
  | { type: 'scene.execute.aborted'; sceneId: string; executionId: string }
  | { type: 'input.osc.received'; address: string; args: unknown[] }
  | { type: 'input.tcp.received'; message: string; client: string }
  | { type: 'system.driver.crashed'; connectionId: string; driverId: string; error: string }
  | { type: 'system.startup.complete' };

class GalleryEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

export const eventBus = new GalleryEventBus();

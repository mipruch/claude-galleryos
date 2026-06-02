/**
 * ApiContext — the dependencies route handlers and the WebSocket layer need.
 * Built once in the composition root and threaded into the route factories.
 */

import type { DeviceManager, LiveStateStore } from "../core/DeviceManager.ts";
import type { DriverRegistry } from "../core/DriverRegistry.ts";
import type { EventBus } from "../core/EventBus.ts";
import type {
  connectionsRepo,
  devicesRepo,
  logsRepo,
  roomsRepo,
  sceneExecutionsRepo,
} from "../db/repositories.ts";

export interface ApiContext {
  deviceManager: DeviceManager;
  driverRegistry: DriverRegistry;
  state: LiveStateStore;
  eventBus: EventBus;
  rooms: typeof roomsRepo;
  connections: typeof connectionsRepo;
  devices: typeof devicesRepo;
  logs: typeof logsRepo;
  sceneExecutions: typeof sceneExecutionsRepo;
  /** Server start time (epoch ms) for uptime reporting. */
  startedAt: number;
}

/**
 * ApiContext — the dependencies route handlers and the WebSocket layer need.
 * Built once in the composition root and threaded into the route factories.
 */

import type { DeviceManager, LiveStateStore } from "../core/DeviceManager.ts";
import type { DriverRegistry } from "../core/DriverRegistry.ts";
import type { EventBus } from "../core/EventBus.ts";
import type { MeterService } from "../core/MeterService.ts";
import type { SceneEngine } from "../core/SceneEngine.ts";
import type { Scheduler } from "../core/Scheduler.ts";
import type { InputMapper } from "../input/InputMapper.ts";
import type {
  camerasRepo,
  connectionsRepo,
  devicesRepo,
  iframesRepo,
  inputMappingsRepo,
  kiosksRepo,
  logsRepo,
  roomsRepo,
  sceneExecutionsRepo,
  scenesRepo,
  scheduledJobsRepo,
} from "../db/repositories.ts";

export interface ApiContext {
  deviceManager: DeviceManager;
  driverRegistry: DriverRegistry;
  state: LiveStateStore;
  eventBus: EventBus;
  rooms: typeof roomsRepo;
  connections: typeof connectionsRepo;
  devices: typeof devicesRepo;
  iframes: typeof iframesRepo;
  cameras: typeof camerasRepo;
  kiosks: typeof kiosksRepo;
  logs: typeof logsRepo;
  scenes: typeof scenesRepo;
  sceneExecutions: typeof sceneExecutionsRepo;
  sceneEngine: SceneEngine;
  meterService: MeterService;
  schedules: typeof scheduledJobsRepo;
  scheduler: Scheduler;
  mappings: typeof inputMappingsRepo;
  inputMapper: InputMapper;
  /** Server start time (epoch ms) for uptime reporting. */
  startedAt: number;
}

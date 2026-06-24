/**
 * GalleryOS server entry point — composition root.
 *
 * Wires the core together: Redis (live state), the DeviceManager (which starts a
 * DriverHost subprocess per enabled connection from the DB), and EventBus audit
 * logging. The HTTP/WS API is added in the next step.
 *
 * Migrations are NOT run here — run `bun run migrate` explicitly first.
 */

import { appConfig } from "./config.ts";
import { errMsg } from "@gallery/driver-core";
import { logger, winstonRoot } from "./logger.ts";
import { closeDb } from "./db/client.ts";
import { dbLogTransport } from "./db/log-transport.ts";
import {
  connectionsRepo,
  dbRepo,
  devicesRepo,
  iframesRepo,
  inputMappingsRepo,
  logsRepo,
  roomsRepo,
  sceneExecutionsRepo,
  scenesRepo,
  scheduledJobsRepo,
} from "./db/repositories.ts";
import { closeRedis, connectRedis } from "./redis/client.ts";
import { redisDriverStore, redisSceneStore, redisStateStore } from "./redis/state.ts";
import { driverRegistry } from "./core/DriverRegistry.ts";
import { eventBus, type GalleryEvent } from "./core/EventBus.ts";
import { DeviceManager } from "./core/DeviceManager.ts";
import { MeterService } from "./core/MeterService.ts";
import { Watchdog } from "./core/Watchdog.ts";
import { SceneEngine } from "./core/SceneEngine.ts";
import { Scheduler } from "./core/Scheduler.ts";
import { InputMapper } from "./input/InputMapper.ts";
import { OscServer } from "./input/OscServer.ts";
import { startApiServer } from "./api/server.ts";
import { assertValidCommandParams } from "./api/validation.ts";

const log = logger.child("bootstrap");

/** Log every event for audit/observability (will also feed the DB sink later). */
function wireAuditLog(): void {
  const audit = logger.child("event_bus");
  eventBus.onAny((event: GalleryEvent) => {
    const level = event.type.endsWith(".failed") || event.type.includes("error") ? "warn" : "debug";
    audit[level](event.type, event as Record<string, unknown>);
  });
}

/**
 * Initializes and starts the GalleryOS server.
 *
 * Sets up core components (DeviceManager, Watchdog, SceneEngine, API server),
 * establishes infrastructure connections (Redis, database logging), and
 * registers graceful shutdown handlers for SIGINT and SIGTERM.
 */
async function main(): Promise<void> {
  log.info("GalleryOS server starting", {
    env: appConfig.env,
    drivers: driverRegistry.list().map((d) => `${d.id}@${d.version}`),
  });

  wireAuditLog();

  // Wire DB log transport — early so startup logs are captured too. Early
  // flushes may fail if the DB isn't ready yet; they are discarded gracefully.
  // Cast needed: winston-transport is a transitive dep so TS can't verify
  // stream.Writable structural compatibility, but the runtime works correctly.
  winstonRoot.add(dbLogTransport as unknown as Parameters<typeof winstonRoot.add>[0]);
  dbLogTransport.start();

  // Fail fast if Redis is unreachable.
  await connectRedis();
  log.info("Redis connected");

  const deviceManager = new DeviceManager({
    repo: dbRepo,
    state: redisStateStore,
    eventBus,
    logger,
    driverKVStore: redisDriverStore,
    supportsSubscriptions: (driverId) =>
      driverRegistry.get(driverId)?.capabilities.subscriptions ?? false,
    supportsEndpointHealth: (driverId) =>
      driverRegistry.get(driverId)?.capabilities.endpointHealth ?? false,
    validateParams: assertValidCommandParams,
    restart: {
      maxAttempts: appConfig.driver.restartMaxAttempts,
      baseDelayMs: appConfig.driver.restartBaseDelayMs,
      maxDelayMs: appConfig.driver.restartMaxDelayMs,
    },
    commandTimeoutMs: appConfig.driver.commandTimeoutMs,
  });

  await deviceManager.start();

  // Live BSS meters: ref-counted fan-out to the browsers watching each meter.
  // One BSS subscription per meter; readings bypass the EventBus/Redis.
  const meterService = new MeterService({ devices: deviceManager, eventBus, logger });
  deviceManager.setMeterListener(meterService.handleMeterUpdate);

  const watchdog = new Watchdog({
    target: deviceManager,
    state: redisStateStore,
    eventBus,
    logger,
    connectionIntervalMs: appConfig.watchdog.connectionIntervalMs,
    endpointIntervalMs: appConfig.watchdog.endpointIntervalMs,
  });
  watchdog.start();

  // Scene engine: executes scenes against devices; also listens for
  // `scene.execute.requested` so the WebSocket layer can trigger runs.
  const sceneEngine = new SceneEngine({
    scenes: scenesRepo,
    executions: sceneExecutionsRepo,
    state: redisSceneStore,
    deviceManager,
    devices: devicesRepo,
    eventBus,
    logger,
  });
  sceneEngine.start();

  // Scheduler: fires scenes on their cron schedules (timezone/DST-aware). Loads
  // enabled jobs from the DB and arms a timer per job; the schedules API keeps it
  // in sync at runtime.
  const scheduler = new Scheduler({
    jobs: scheduledJobsRepo,
    sceneEngine,
    logger,
  });
  await scheduler.start();

  // Input mapper: turns incoming OSC/TCP/HTTP signals into scene runs / device
  // commands / events via the `input_mappings` rules. Caches the enabled rules;
  // the mappings REST controller reloads it on every edit. The transport servers
  // (TCP/OSC ingress) feed it normalized signals — wired in a later step.
  const inputMapper = new InputMapper({
    repo: inputMappingsRepo,
    logger,
    sceneEngine,
    deviceManager,
    eventBus,
  });
  await inputMapper.start();

  // OSC ingress: a UDP server that feeds incoming OSC messages through the same
  // InputMapper. Optional — a bind failure (e.g. port in use) is logged but never
  // takes down device control.
  const oscServer = new OscServer({
    inputMapper,
    eventBus,
    logger,
    port: appConfig.input.oscPort,
  });
  try {
    await oscServer.start();
  } catch (err) {
    log.error("OSC input server failed to start; OSC ingress disabled", {
      port: appConfig.input.oscPort,
      error: errMsg(err),
    });
  }

  // HTTP + WebSocket API.
  const apiServer = startApiServer({
    deviceManager,
    driverRegistry,
    state: redisStateStore,
    eventBus,
    rooms: roomsRepo,
    connections: connectionsRepo,
    devices: devicesRepo,
    iframes: iframesRepo,
    logs: logsRepo,
    scenes: scenesRepo,
    sceneExecutions: sceneExecutionsRepo,
    sceneEngine,
    meterService,
    schedules: scheduledJobsRepo,
    scheduler,
    mappings: inputMappingsRepo,
    inputMapper,
    startedAt: Date.now(),
  });

  eventBus.emit({ type: "system.startup.complete" });
  log.info("GalleryOS core ready");

  // Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Shutting down (${signal})`);
    oscServer.stop();
    scheduler.stop();
    sceneEngine.stop();
    watchdog.stop();
    await apiServer.stop(true);
    await deviceManager.stop();
    await closeRedis();
    // Drain buffered logs before the DB connection closes.
    await dbLogTransport.stop();
    await closeDb();
    log.info("Shutdown complete");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Fatal startup error", { error: errMsg(err) });
  process.exit(1);
});

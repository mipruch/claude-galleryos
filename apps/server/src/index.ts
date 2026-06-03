/**
 * GalleryOS server entry point — composition root.
 *
 * Wires the core together: Redis (live state), the DeviceManager (which starts a
 * DriverHost subprocess per enabled connection from the DB), and EventBus audit
 * logging. The HTTP/WS API is added in the next step.
 *
 * Migrations are NOT run here — run `bun run migrate` explicitly first.
 */

import { config } from "./config.ts";
import { logger, winstonRoot } from "./logger.ts";
import { closeDb } from "./db/client.ts";
import { dbLogTransport } from "./db/log-transport.ts";
import {
  connectionsRepo,
  dbRepo,
  devicesRepo,
  logsRepo,
  roomsRepo,
  sceneExecutionsRepo,
  scenesRepo,
} from "./db/repositories.ts";
import { closeRedis, connectRedis } from "./redis/client.ts";
import { redisDriverStore, redisSceneStore, redisStateStore } from "./redis/state.ts";
import { driverRegistry } from "./core/DriverRegistry.ts";
import { eventBus, type GalleryEvent } from "./core/EventBus.ts";
import { DeviceManager } from "./core/DeviceManager.ts";
import { Watchdog } from "./core/Watchdog.ts";
import { SceneEngine } from "./core/SceneEngine.ts";
import { startApiServer } from "./api/server.ts";

const log = logger.child("bootstrap");

/** Log every event for audit/observability (will also feed the DB sink later). */
function wireAuditLog(): void {
  const audit = logger.child("event_bus");
  eventBus.onAny((event: GalleryEvent) => {
    const level = event.type.endsWith(".failed") || event.type.includes("error") ? "warn" : "debug";
    audit[level](event.type, event as Record<string, unknown>);
  });
}

async function main(): Promise<void> {
  log.info("GalleryOS server starting", {
    env: config.env,
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
    restart: {
      maxAttempts: config.driver.restartMaxAttempts,
      baseDelayMs: config.driver.restartBaseDelayMs,
      maxDelayMs: config.driver.restartMaxDelayMs,
    },
    commandTimeoutMs: config.driver.commandTimeoutMs,
  });

  await deviceManager.start();

  const watchdog = new Watchdog({
    target: deviceManager,
    state: redisStateStore,
    eventBus,
    logger,
    connectionIntervalMs: config.watchdog.connectionIntervalMs,
    endpointIntervalMs: config.watchdog.endpointIntervalMs,
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

  // HTTP + WebSocket API.
  const apiServer = startApiServer({
    deviceManager,
    driverRegistry,
    state: redisStateStore,
    eventBus,
    rooms: roomsRepo,
    connections: connectionsRepo,
    devices: devicesRepo,
    logs: logsRepo,
    scenes: scenesRepo,
    sceneExecutions: sceneExecutionsRepo,
    sceneEngine,
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
  log.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

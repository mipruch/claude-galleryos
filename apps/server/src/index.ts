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
import { logger } from "./logger.ts";
import { closeDb } from "./db/client.ts";
import { connectionsRepo, dbRepo, devicesRepo, roomsRepo } from "./db/repositories.ts";
import { closeRedis, connectRedis } from "./redis/client.ts";
import { redisDriverStore, redisStateStore } from "./redis/state.ts";
import { driverRegistry } from "./core/DriverRegistry.ts";
import { eventBus, type GalleryEvent } from "./core/EventBus.ts";
import { DeviceManager } from "./core/DeviceManager.ts";
import { Watchdog } from "./core/Watchdog.ts";
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

  // HTTP + WebSocket API.
  const apiServer = startApiServer({
    deviceManager,
    driverRegistry,
    state: redisStateStore,
    eventBus,
    rooms: roomsRepo,
    connections: connectionsRepo,
    devices: devicesRepo,
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
    watchdog.stop();
    await apiServer.stop(true);
    await deviceManager.stop();
    await closeRedis();
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

/**
 * Centralised, typed configuration loaded from the environment.
 *
 * Bun automatically loads `.env` files, so no dotenv dependency is needed.
 * All env access happens here; the rest of the code imports the typed `config`.
 */

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

type LogLevel = "debug" | "info" | "warn" | "error";

export const appConfig = {
  env: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV", "development") === "production",

  server: {
    port: int("PORT", 3000),
  },

  log: {
    level: str("LOG_LEVEL", "info") as LogLevel,
    filePath: str("LOG_FILE_PATH", "./logs/gallery.log"),
    retentionDays: int("LOG_RETENTION_DAYS", 90),
  },

  db: {
    url: str("DATABASE_URL", "postgresql://gallery:gallery_dev_password@localhost:5432/gallery"),
  },

  redis: {
    url: str("REDIS_URL", "redis://localhost:6379"),
  },

  input: {
    oscPort: int("OSC_PORT", 8765),
    tcpPort: int("TCP_INPUT_PORT", 8766),
  },

  watchdog: {
    connectionIntervalMs: int("WATCHDOG_CONNECTION_INTERVAL_MS", 10_000),
    endpointIntervalMs: int("WATCHDOG_ENDPOINT_INTERVAL_MS", 60_000),
  },

  driver: {
    restartMaxAttempts: int("DRIVER_RESTART_MAX_ATTEMPTS", 0), // 0 = unlimited
    restartBaseDelayMs: int("DRIVER_RESTART_BASE_DELAY_MS", 1_000),
    restartMaxDelayMs: int("DRIVER_RESTART_MAX_DELAY_MS", 30_000),
    // Budget for a single driver IPC round-trip (command/state/health). Must
    // exceed a driver's own per-transaction timeout so the host doesn't abandon
    // the call while the driver is still talking to the device — e.g. PJLink
    // opens a fresh socket per command (connect + banner + command). A health
    // check holding the driver's I/O lock plus a queued user command must both
    // fit inside this window, hence the comfortable default.
    commandTimeoutMs: int("DRIVER_COMMAND_TIMEOUT_MS", 5_000),
  },
} as const;

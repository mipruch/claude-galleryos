export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFilePath: string;
  oscPort: number;
  tcpInputPort: number;
  watchdogConnectionIntervalMs: number;
  watchdogEndpointIntervalMs: number;
  driverRestartBaseDelayMs: number;
  driverRestartMaxDelayMs: number;
  driverRestartMaxAttempts: number;
  logRetentionDays: number;
  nodeEnv: string;
}

function num(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AppConfig = {
  port: num(process.env.PORT, 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://gallery:gallery_dev_password@localhost:5432/gallery',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  logFilePath: process.env.LOG_FILE_PATH ?? './logs/gallery.log',
  oscPort: num(process.env.OSC_PORT, 8765),
  tcpInputPort: num(process.env.TCP_INPUT_PORT, 8766),
  watchdogConnectionIntervalMs: num(process.env.WATCHDOG_CONNECTION_INTERVAL_MS, 10000),
  watchdogEndpointIntervalMs: num(process.env.WATCHDOG_ENDPOINT_INTERVAL_MS, 60000),
  driverRestartBaseDelayMs: num(process.env.DRIVER_RESTART_BASE_DELAY_MS, 1000),
  driverRestartMaxDelayMs: num(process.env.DRIVER_RESTART_MAX_DELAY_MS, 30000),
  driverRestartMaxAttempts: num(process.env.DRIVER_RESTART_MAX_ATTEMPTS, 0),
  logRetentionDays: num(process.env.LOG_RETENTION_DAYS, 90),
  nodeEnv: process.env.NODE_ENV ?? 'production',
};

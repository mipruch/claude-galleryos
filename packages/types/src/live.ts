/**
 * Live (Redis-backed) state and status contracts — shared by the server's state
 * store / DeviceManager / Watchdog and the UI stores.
 *
 * These never touch PostgreSQL: they are the disposable runtime view of a
 * device/connection (online?, latency, last error) and a device's driver-specific
 * values (fader level, mute, brightness, …). See README §5 "Redis keys".
 */

/** Driver-specific live values, e.g. `{ level, muted }` or `{ brightness, on }`. */
export type DeviceState = Record<string, unknown>;

/** Online/offline + latency, as stored under `*:status` Redis keys. */
export interface LiveStatus {
  online: boolean;
  latencyMs?: number;
  lastSeen?: string;
  lastError?: string;
}

/** Status of a single device endpoint (`device:{id}:status`). */
export type DeviceStatus = LiveStatus;

/** Status of a connection / gateway socket (`connection:{id}:status`). */
export type ConnectionStatus = LiveStatus;

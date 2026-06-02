/**
 * Redis-backed implementations of the live-state interfaces.
 *
 * Key layout (README §5):
 *   device:{id}:status      → { online, latencyMs, lastSeen, lastError }
 *   device:{id}:state       → { ...driver-specific values }
 *   connection:{id}:status  → { online, latencyMs, lastSeen }
 *   driver:{connId}:kv:{k}  → per-driver KV store
 */

import type { DriverKVStore } from "@gallery/driver-core";
import type {
  ConnectionStatus,
  DeviceStatus,
  LiveStateStore,
} from "../core/DeviceManager.ts";
import { redis } from "./client.ts";

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw == null ? null : (JSON.parse(raw) as T);
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await redis.set(key, JSON.stringify(value));
}

/** Live state/status store backed by Redis. */
export const redisStateStore: LiveStateStore = {
  setDeviceState: (deviceId, state) => writeJson(`device:${deviceId}:state`, state),
  getDeviceState: (deviceId) => readJson<Record<string, unknown>>(`device:${deviceId}:state`),
  setDeviceStatus: (deviceId, status: DeviceStatus) =>
    writeJson(`device:${deviceId}:status`, status),
  getDeviceStatus: (deviceId) => readJson<DeviceStatus>(`device:${deviceId}:status`),
  setConnectionStatus: (connectionId, status: ConnectionStatus) =>
    writeJson(`connection:${connectionId}:status`, status),
  getConnectionStatus: (connectionId) => readJson<ConnectionStatus>(`connection:${connectionId}:status`),
};

/** Per-connection KV store handed to a driver via its context. */
export function redisDriverStore(connectionId: string): DriverKVStore {
  const prefix = `driver:${connectionId}:kv:`;
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const value = await readJson<T>(prefix + key);
      return value ?? undefined;
    },
    async set(key, value) {
      await writeJson(prefix + key, value);
    },
    async delete(key) {
      await redis.del(prefix + key);
    },
  };
}

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
import type { ConnectionStatus, DeviceStatus } from "@gallery/types";
import type { LiveStateStore } from "../core/DeviceManager.ts";
import { redis } from "./client.ts";

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw == null ? null : (JSON.parse(raw) as T);
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await redis.set(key, JSON.stringify(value));
}

/**
 * True when a state merge would silently erase a known non-zero brightness.
 *
 * DALI drivers report `brightness: 0` whenever the light is physically off,
 * but we want to remember the last intended level so:
 *   - sliders stay at the correct position across all UIs while off, and
 *   - turning back on restores that level without needing to re-set the fader.
 */
function shouldPreserveBrightness(
  existing: Record<string, unknown>,
  merged: Record<string, unknown>,
): boolean {
  const turningOff = merged.on === false || merged.power === false;
  return turningOff && !merged.brightness && !!existing.brightness;
}

/** Merge a driver state patch into the existing stored state. */
function mergeDeviceState(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing, ...patch };
  if (shouldPreserveBrightness(existing, merged)) merged.brightness = existing.brightness;
  return merged;
}

/** Live state/status store backed by Redis. */
export const redisStateStore: LiveStateStore = {
  setDeviceState: async (deviceId, patch) => {
    const existing = (await readJson<Record<string, unknown>>(`device:${deviceId}:state`)) ?? {};
    await writeJson(`device:${deviceId}:state`, mergeDeviceState(existing, patch));
  },
  getDeviceState: (deviceId) => readJson<Record<string, unknown>>(`device:${deviceId}:state`),
  setDeviceStatus: (deviceId, status: DeviceStatus) =>
    writeJson(`device:${deviceId}:status`, status),
  getDeviceStatus: (deviceId) => readJson<DeviceStatus>(`device:${deviceId}:status`),
  setConnectionStatus: (connectionId, status: ConnectionStatus) =>
    writeJson(`connection:${connectionId}:status`, status),
  getConnectionStatus: (connectionId) => readJson<ConnectionStatus>(`connection:${connectionId}:status`),
};

/**
 * Scene execution lock backed by Redis (`scene:{id}:active`).
 *
 * The SceneEngine sets this for the duration of a run so a second execute of the
 * same scene is rejected (409). No TTL: a crash leaves it set (no crash recovery
 * in the simplified plan), but the value is cleared on every normal completion.
 */
export const redisSceneStore = {
  setSceneActive: (sceneId: string) => writeJson(`scene:${sceneId}:active`, { since: Date.now() }),
  clearSceneActive: async (sceneId: string): Promise<void> => {
    await redis.del(`scene:${sceneId}:active`);
  },
  isSceneActive: async (sceneId: string): Promise<boolean> => {
    return (await redis.get(`scene:${sceneId}:active`)) != null;
  },
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

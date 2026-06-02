/**
 * Test doubles for the host-provided driver context and KV storage.
 */

import type { DriverContext, DriverKVStore, DriverLogger } from "@gallery/driver-core";

export const silentLogger: DriverLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A simple in-memory implementation of the driver KV store. */
export function memoryStore(): DriverKVStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/** Build a driver context for tests. Returns the context and its AbortController. */
export function testContext(dryRun = false): { ctx: DriverContext; abort: AbortController } {
  const abort = new AbortController();
  return {
    abort,
    ctx: { logger: silentLogger, storage: memoryStore(), dryRun, signal: abort.signal },
  };
}

/**
 * Redis connection (Bun's native RedisClient).
 *
 * Redis holds live, disposable state only (device/connection status, current
 * values). It can be lost at any time and is rebuilt from device queries.
 */

import { RedisClient } from "bun";
import { appConfig } from "../config.ts";

/** Shared Redis client. Bun connects lazily on first command. */
export const redis = new RedisClient(appConfig.redis.url);

/** Eagerly connect (for fail-fast startup) and return the client. */
export async function connectRedis(): Promise<RedisClient> {
  await redis.connect();
  return redis;
}

export async function closeRedis(): Promise<void> {
  redis.close();
}

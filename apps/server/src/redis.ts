import Redis from 'ioredis';
import { config } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('redis');

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

redis.on('connect', () => log.info('Redis connected'));
redis.on('error', (err) => log.warn('Redis error', { error: err.message }));

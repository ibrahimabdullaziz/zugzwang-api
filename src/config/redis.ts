import { Redis } from 'ioredis';
import { config } from './env.js';
import { logger } from './logger.js';

const cacheRedis = new Redis(config.redis.url, {
  retryStrategy(times: number) {
    if (times > 20) {
      logger.warn('Redis retry limit reached');
      return null;
    }
    const jitter = Math.floor(Math.random() * 200);
    const delay = Math.min(Math.pow(2, times - 1) * 50, 1800);
    return delay + jitter;
  },
});

const pubRedis = cacheRedis.duplicate();
const subRedis = cacheRedis.duplicate();

export { cacheRedis, pubRedis, subRedis };

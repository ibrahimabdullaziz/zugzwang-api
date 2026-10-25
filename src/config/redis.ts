import { Redis } from 'ioredis';
import { config } from './env.js';
import { logger } from './logger.js';
import { events } from '../common/utils/redisEvents.js';

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

events(cacheRedis, 'Cache Redis');
events(pubRedis, 'Publisher Redis');
events(subRedis, 'Subscriber Redis');

export { cacheRedis, pubRedis, subRedis };

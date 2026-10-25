import { logger } from '../../config/logger.js';
import { cacheRedis } from '../../config/redis.js';

const inFlight = new Map<string, Promise<unknown>>();

export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) {
    return (await pending) as T;
  }

  const task = (async (): Promise<T> => {
    try {
      const value = await cacheRedis.get(key);

      if (value !== null) {
        return JSON.parse(value) as T;
      }
    } catch {
      // Redis failure: fall back to the loader.
    }

    const data = await loader();
    const jitter = Math.floor(Math.random() * (ttlSeconds * 0.1));
    const actualTTL = ttlSeconds + jitter;

    try {
      await cacheRedis.set(key, JSON.stringify(data), 'EX', actualTTL);
    } catch {
      logger.warn({ component: 'redis', key }, 'Failed to cache loaded data');
    }

    return data;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.has(key)) inFlight.delete(key);
  }
}

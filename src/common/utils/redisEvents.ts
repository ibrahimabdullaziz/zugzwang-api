import { logger } from '../../config/logger.js';

type RedisEventSource = {
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'reconnecting', listener: (delayMs: number) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
};

export function events(redisInstance: RedisEventSource, name: string) {
  redisInstance.on('connect', () => {
    logger.debug({ component: 'redis', client: name }, `${name} Connection established`);
  });

  redisInstance.on('ready', () => {
    logger.info({ component: 'redis', client: name }, `${name} Client is ready for connection`);
  });

  redisInstance.on('error', (err: Error) => {
    logger.warn(
      {
        component: 'redis',
        client: name,
        err: {
          name: err.name,
          message: err.message,
        },
      },
      `${name} connection error`,
    );
  });

  redisInstance.on('close', () => {
    logger.warn({ component: 'redis', client: name }, `${name} closed`);
  });

  redisInstance.on('reconnecting', (delayMs: number) => {
    logger.info({ component: 'redis', delayMs, client: name }, `reconnecting to ${name}`);
  });

  redisInstance.on('end', () => {
    logger.error({ component: 'redis', client: name }, `${name} connection ended`);
  });
}

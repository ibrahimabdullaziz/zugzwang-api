import pino, { type Bindings, type Logger } from 'pino';
import { config } from './env.js';

const logger = pino({
  level: config.logging.level,
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'token',
      'refreshToken',
    ],
  },
  ...(config.server.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      }
    : {}),
});

export { logger };

export function childLogger(bindings: Bindings): Logger {
  return logger.child(bindings);
}

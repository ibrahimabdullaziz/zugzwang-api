import pino, { type Bindings, type Logger } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'token',
      'refreshToken',
    ],
  },
  ...((process.env.NODE_ENV ?? 'development') === 'development'
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

import { Logger } from 'pino';
import { Socket } from 'socket.io';
import { AppError } from '../common/errors/AppError.js';

type SocketHandler<Args extends unknown[]> = (
  socket: Socket,
  ...args: Args
) => Promise<unknown> | void;

export function safeHandler<Args extends unknown[]>(
  handler: SocketHandler<Args>,
  logger: Logger,
) {
  return async function (this: Socket, ...args: Args) {
    const maybeAck = args[args.length - 1];
    const hasAck = typeof maybeAck === 'function';
    const ack = hasAck ? maybeAck : null;
    try {
      await handler(this, ...args);
    } catch (error: unknown) {
      logger.error({ err: error }, 'Socket event handler error');

      const message =
        error instanceof AppError ? error.message : 'Internal Socket Server Error';
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';

      if (ack) {
        ack({ ok: false, error: message });
      }

      this.emit('game:error', { code, message });
    }
  };
}

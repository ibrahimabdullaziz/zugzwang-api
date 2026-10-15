import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../common/security/tokens.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import { Http2Server } from 'node:http2';
import { Logger } from 'pino';

interface SocketServerDeps {
  logger: Logger;
  corsOrigin: string | string[];
  // sessionManager: GameSessionManager;
}

export async function createSocketServer(httpServer: Http2Server, deps: SocketServerDeps) {
  const { logger, corsOrigin } = deps;
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const payload = verifyAccessToken(token);

      if (!payload) {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: Invalid token');
        next(new AppError(ErrorCode.UNAUTHORIZED, 403, 'Invalid Token'));
      }

      socket.data.user = { id: payload.sub, role: payload.role };

      logger.info(
        { socketId: socket.id, userId: payload.sub },
        'Socket authenticated successfully',
      );
      next();
    } catch {
      next(new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error'));
    }
  });

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.user?.id }, 'Client connected');

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });
  });

  return io;
}

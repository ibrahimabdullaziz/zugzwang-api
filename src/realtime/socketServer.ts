import { gameActionSchema, gameMoveSchema } from './schemas.js';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../common/security/tokens.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import type { Server as HttpServer } from 'node:http';
import { Logger } from 'pino';
import { findById as findGameById } from '../modules/games/games.repository.js';
import { GameSessionManager } from './GameSessionManager.js';
import { gameJoinSchema } from './schemas.js';

interface SocketServerDeps {
  logger: Logger;
  corsOrigin: string | readonly string[];
}

export function createSocketServer(httpServer: HttpServer, deps: SocketServerDeps) {
  const { logger, corsOrigin } = deps;
  const io = new Server(httpServer, {
    cors: {
      origin: Array.isArray(corsOrigin) ? [...corsOrigin] : (corsOrigin as string),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: No token provided');
        next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or missing token'));
        return;
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: Invalid token');
        next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid Token'));
        return;
      }

      socket.data.user = { id: payload.sub, role: payload.role };

      logger.info(
        { socketId: socket.id, userId: payload.sub },
        'Socket authenticated successfully',
      );
      next();
    } catch {
      next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.user?.id }, 'Client connected');

    socket.on('game:join', async (gameId: string) => {
      try {
        const validation = gameJoinSchema.safeParse(gameId);
        if (!validation.success) {
          socket.emit('error', {
            message: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
          return;
        }
        const game = await findGameById(gameId);

        if (!game) {
          socket.emit('error', { message: 'This game isn`t exists' });
          return;
        }

        const gameSession = GameSessionManager.getInstance();
        const session = await gameSession.getOrLoad(gameId);

        if (!session) {
          socket.emit('error', { message: 'Game not found or finished' });
          return;
        }

        const userId = socket.data.user.id;
        const isPlayer = userId === game.whiteId || userId === game.blackId;
        const role = isPlayer ? 'player' : 'spectator';
        const roomName = `game:${gameId}`;

        await socket.join(roomName);

        socket.emit('game:state', {
          pgn: game.pgn,
          role: role,
        });
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:join');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('game:move', async (data, ack) => {
      try {
        const validation = gameMoveSchema.safeParse(data);
        if (!validation.success) {
          return ack({ ok: false, error: validation.error.issues[0]?.message ?? 'Invalid move' });
        }
        const sessionManager = GameSessionManager.getInstance();

        const session = await sessionManager.getOrLoad(data.gameId);
        if (!session) {
          return ack({ ok: false, error: 'Game session not found' });
        }

        const move = await session.handleMove(socket.data.user.id, data.uci);

        io.to(`game:${data.gameId}`).emit('game:move', {
          ply: move.ply,
          san: move.san,
          uci: move.uci,
          fen: move.fen,
        });

        ack({ ok: true });

        if (move.outcome?.result) {
          io.to(`game:${data.gameId}`).emit(`game:over`, {
            result: move.outcome.result,
            reason: move.outcome.reason || 'CHECKMATE',
          });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:join');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('game:resign', async (gameId: string, ack) => {
      try {
        const validation = gameActionSchema.safeParse({ gameId });
        if (!validation.success) {
          return ack({
            ok: false,
            error: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
        }
        const { gameId: validatedGameId } = validation.data;
        const sessionManager = GameSessionManager.getInstance();

        const session = await sessionManager.getOrLoad(validatedGameId);
        if (!session) {
          return ack({ ok: false, error: 'Game session not found' });
        }

        const outcome = await session.resign(socket.data.user.id);

        io.to(`game:${validatedGameId}`).emit('game:over', {
          result: outcome.result,
          reason: outcome.reason,
        });

        ack({ ok: true });
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:resign');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('game:draw:offer', async (gameId: string, ack) => {
      try {
        const validation = gameActionSchema.safeParse({ gameId });
        if (!validation.success) {
          return ack({
            ok: false,
            error: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
        }
        const { gameId: validatedGameId } = validation.data;
        const sessionManager = GameSessionManager.getInstance();

        const session = await sessionManager.getOrLoad(validatedGameId);
        if (!session) {
          return ack({ ok: false, error: 'Game session not found' });
        }

        await session.handleDrawOffer(socket.data.user.id);

        io.to(`game:${validatedGameId}`).emit('game:draw:offered', {
          offeredBy: socket.data.user.id,
        });

        ack({ ok: true });
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:resign');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('game:draw:accept', async (gameId: string, ack) => {
      try {
        const validation = gameActionSchema.safeParse({ gameId });
        if (!validation.success) {
          return ack({
            ok: false,
            error: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
        }
        const { gameId: validatedGameId } = validation.data;
        const sessionManager = GameSessionManager.getInstance();

        const session = await sessionManager.getOrLoad(validatedGameId);
        if (!session) {
          return ack({ ok: false, error: 'Game session not found' });
        }

        const outcome = await session.handleDrawAccept(socket.data.user.id);

        io.to(`game:${validatedGameId}`).emit('game:over', {
          result: outcome?.result,
          reason: outcome?.reason,
        });

        ack({ ok: true });
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:resign');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('game:draw:decline', async (gameId: string, ack) => {
      try {
        const validation = gameActionSchema.safeParse({ gameId });
        if (!validation.success) {
          return ack({
            ok: false,
            error: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
        }
        const { gameId: validatedGameId } = validation.data;
        const sessionManager = GameSessionManager.getInstance();

        const session = await sessionManager.getOrLoad(validatedGameId);
        if (!session) {
          return ack({ ok: false, error: 'Game session not found' });
        }

        await session.handleDrawDecline(socket.data.user.id);

        io.to(`game:${validatedGameId}`).emit('game:draw:declined', {
          offeredBy: socket.data.user.id,
        });

        ack({ ok: true });
      } catch (error) {
        logger.error({ err: error }, 'Error handling game:resign');
        socket.emit('error', { message: 'Internal Server Error' });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });
  });

  return io;
}

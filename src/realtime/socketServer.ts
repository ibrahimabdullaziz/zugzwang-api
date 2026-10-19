import { MatchMaking } from './../modules/matchmaking/matchmaking.service.js';
import { InMemoryMatchmaker } from '../modules/matchmaking/InMemoryMatchmaker.js';
import { gameActionSchema, gameMoveSchema, queueJoinSchema } from './schemas.js';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../common/security/tokens.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import type { Server as HttpServer } from 'node:http';
import { Logger } from 'pino';
import { findById as findGameById } from '../modules/games/games.repository.js';
import { GameSessionManager } from './GameSessionManager.js';
import { gameJoinSchema } from './schemas.js';
import { safeHandler } from './safeHandler.js';

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
  const matchmaking = new MatchMaking(new InMemoryMatchmaker(), io);
  matchmaking.start();

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

    socket.on(
      'game:join',
      safeHandler(async (socket, data: { gameId: string }) => {
        const validation = gameJoinSchema.safeParse(data);
        if (!validation.success) {
          socket.emit('error', {
            message: validation.error.issues[0]?.message ?? 'Invalid game ID',
          });
          return;
        }
        const { gameId } = validation.data;
        const game = await findGameById(gameId);

        if (!game) {
          socket.emit('error', { message: 'This game isn`t exists' });
          return;
        }

        const gameSession = GameSessionManager.getInstance();
        const session = await gameSession.getOrLoad(gameId, io);

        if (!session) {
          socket.emit('error', { message: 'Game not found or finished' });
          return;
        }

        const userId = socket.data.user.id;
        const isPlayer = userId === game.whiteId || userId === game.blackId;
        const role = isPlayer ? 'player' : 'spectator';
        const roomName = `game:${gameId}`;

        if (isPlayer) {
          const oldSocketId =
            userId === session.whiteId ? session.whiteSocketId : session.blackSocketId;

          if (oldSocketId && oldSocketId !== socket.id) {
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            oldSocket?.disconnect();
          }
        }

        if (userId === session.whiteId) session.whiteSocketId = socket.id;
        if (userId === session.blackId) session.blackSocketId = socket.id;

        await session.handleReconnect(userId, socket.id, io);

        await socket.join(roomName);

        socket.emit('clock:update', session.clock.getSnapshot(performance.now()));
        socket.emit('game:state', {
          pgn: game.pgn,
          role: role,
        });
      }, logger),
    );

    socket.on(
      'game:move',
      safeHandler(
        async (
          socket,
          data: { gameId: string; uci: string },
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const validation = gameMoveSchema.safeParse(data);
          if (!validation.success) {
            return ack({ ok: false, error: validation.error.issues[0]?.message ?? 'Invalid move' });
          }
          const sessionManager = GameSessionManager.getInstance();

          const session = await sessionManager.getOrLoad(data.gameId, io);
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
        },
        logger,
      ),
    );

    socket.on(
      'game:resign',
      safeHandler(
        async (
          socket,
          gameId: string,
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const validation = gameActionSchema.safeParse({ gameId });
          if (!validation.success) {
            return ack({
              ok: false,
              error: validation.error.issues[0]?.message ?? 'Invalid game ID',
            });
          }
          const { gameId: validatedGameId } = validation.data;
          const sessionManager = GameSessionManager.getInstance();

          const session = await sessionManager.getOrLoad(validatedGameId, io);
          if (!session) {
            return ack({ ok: false, error: 'Game session not found' });
          }

          const outcome = await session.resign(socket.data.user.id);

          io.to(`game:${validatedGameId}`).emit('game:over', {
            result: outcome.result,
            reason: outcome.reason,
          });

          ack({ ok: true });
        },
        logger,
      ),
    );

    socket.on(
      'game:draw:offer',
      safeHandler(
        async (
          socket,
          gameId: string,
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const validation = gameActionSchema.safeParse({ gameId });
          if (!validation.success) {
            return ack({
              ok: false,
              error: validation.error.issues[0]?.message ?? 'Invalid game ID',
            });
          }
          const { gameId: validatedGameId } = validation.data;
          const sessionManager = GameSessionManager.getInstance();

          const session = await sessionManager.getOrLoad(validatedGameId, io);
          if (!session) {
            return ack({ ok: false, error: 'Game session not found' });
          }

          await session.handleDrawOffer(socket.data.user.id);

          io.to(`game:${validatedGameId}`).emit('game:draw:offered', {
            offeredBy: socket.data.user.id,
          });

          ack({ ok: true });
        },
        logger,
      ),
    );

    socket.on(
      'game:draw:accept',
      safeHandler(
        async (
          socket,
          gameId: string,
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const validation = gameActionSchema.safeParse({ gameId });
          if (!validation.success) {
            return ack({
              ok: false,
              error: validation.error.issues[0]?.message ?? 'Invalid game ID',
            });
          }
          const { gameId: validatedGameId } = validation.data;
          const sessionManager = GameSessionManager.getInstance();

          const session = await sessionManager.getOrLoad(validatedGameId, io);
          if (!session) {
            return ack({ ok: false, error: 'Game session not found' });
          }

          const outcome = await session.handleDrawAccept(socket.data.user.id);

          io.to(`game:${validatedGameId}`).emit('game:over', {
            result: outcome?.result,
            reason: outcome?.reason,
          });

          ack({ ok: true });
        },
        logger,
      ),
    );

    socket.on(
      'game:draw:decline',
      safeHandler(
        async (
          socket,
          gameId: string,
          ack: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const validation = gameActionSchema.safeParse({ gameId });
          if (!validation.success) {
            return ack({
              ok: false,
              error: validation.error.issues[0]?.message ?? 'Invalid game ID',
            });
          }
          const { gameId: validatedGameId } = validation.data;
          const sessionManager = GameSessionManager.getInstance();

          const session = await sessionManager.getOrLoad(validatedGameId, io);
          if (!session) {
            return ack({ ok: false, error: 'Game session not found' });
          }

          await session.handleDrawDecline(socket.data.user.id);

          io.to(`game:${validatedGameId}`).emit('game:draw:declined', {
            offeredBy: socket.data.user.id,
          });

          ack({ ok: true });
        },
        logger,
      ),
    );

    socket.on(
      'queue:join',
      safeHandler(
        async (
          socket: Socket,
          data: unknown,
          ack?: (res: { ok: boolean; error?: string }) => void,
        ) => {
          const validated = queueJoinSchema.parse(data);
          await matchmaking.joinQueue(socket.data.user.id, socket.id, validated);

          if (ack) ack({ ok: true });
        },
        logger,
      ),
    );

    socket.on(
      'queue:leave',
      safeHandler(async (socket: Socket, ack?: (res: { ok: boolean; error?: string }) => void) => {
        matchmaking.leaveQueue(socket.data.user.id);

        if (ack) ack({ ok: true });
      }, logger),
    );

    socket.on(
      'disconnect',
      safeHandler(async (socket, reason: string) => {
        logger.info({ socketId: socket.id, reason }, 'Client disconnected');

        const sessionManager = GameSessionManager.getInstance();

        for (const session of sessionManager.getAllSessions?.() || []) {
          if (session.whiteSocketId === socket.id || session.blackSocketId === socket.id) {
            await session.handleDisconnect(socket.id, io);
            break;
          }
        }

        if (socket.data?.user?.id) {
          matchmaking.leaveQueue(socket.data.user.id);
        }
      }, logger),
    );
  });

  return io;
}

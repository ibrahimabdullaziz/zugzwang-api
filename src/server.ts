import { createServer } from 'node:http';
import { Router } from 'express';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { gamesRouter } from './modules/games/games.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import ratingsRouter from './modules/ratings/ratings.routes.js';
import { createSocketServer } from './realtime/socketServer.js';
import './config/redis.js';
import authGuard from './common/middleware/authGuard.js';
import { Role } from '@prisma/client';
import roleGuard from './common/middleware/roleGuard.js';
import { bullBoardRouter } from './modules/jobs/bull-board.router.js';
import { EnginePool } from './modules/engine/EnginePool.js';

const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/games', gamesRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/leaderboard', ratingsRouter);

apiRouter.use('/admin/queues', authGuard, roleGuard(Role.ADMIN), bullBoardRouter);

const app = createApp({
  routes: apiRouter,
  corsOrigins: config.server.corsOrigins,
});

const server = createServer(app);
const enginePool = new EnginePool();
enginePool.initialize();

createSocketServer(server, {
  logger,
  corsOrigin: config.server.corsOrigins,
  enginePool,
});

server.on('error', (error) => {
  logger.error({ err: error }, 'HTTP server failed');
  process.exitCode = 1;
});

server.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'HTTP server listening');
});

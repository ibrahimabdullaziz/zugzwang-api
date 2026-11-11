import { Job } from 'bullmq';
import { prisma } from '../../../db/prisma.js';
import { MaintenanceJobPayload } from '../../../config/queues.js';
import { cleanupStaleActiveGames } from '../../games/game-presence.service.js';
import { AppError } from '../../../common/errors/AppError.js';
import { ErrorCode } from '../../../common/errors/codes.js';

export async function cleanupStaleWaitingGames(): Promise<void> {
  const now = new Date();
  const timeBeforeHour = new Date(now.getTime() - 60 * 60 * 1000);

  await prisma.game.updateMany({
    where: {
      createdAt: { lt: timeBeforeHour },
      status: 'WAITING',
    },
    data: {
      status: 'ABANDONED',
      result: 'DRAW',
      reason: 'ABANDONED',
      finishedAt: now,
    },
  });
}

export async function purgeRefreshTokens(): Promise<void> {
  const now = new Date();
  await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { NOT: { revokedAt: null } }] },
  });
}

export async function maintenanceProcessor(job: Job<MaintenanceJobPayload>): Promise<void> {
  const task = job.data.task;

  switch (task) {
    case 'cleanup-waiting':
      await cleanupStaleWaitingGames();
      break;

    case 'purge-tokens':
      await purgeRefreshTokens();
      break;
    case 'abandon-stale':
      await cleanupStaleActiveGames();
      break;

    default:
      throw new AppError(ErrorCode.NOT_FOUND, 404, `Unknown maintenance task: ${task}`);
      break;
  }
}

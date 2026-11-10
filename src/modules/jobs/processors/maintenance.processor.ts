import { prisma } from '../../../db/prisma.js';

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

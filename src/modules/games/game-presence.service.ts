import { cacheRedis } from '../../config/redis.js';
import { prisma } from '../../db/prisma.js';

export async function setPlayerConnected(gameId: string, color: 'white' | 'black'): Promise<void> {
  const key = `game:${gameId}:presence`;

  await cacheRedis.hset(key, { [`${color}Connected`]: 'true', [`${color}DisconnectedAt`]: '' });
}

export async function setPlayerDisconnected(
  gameId: string,
  color: 'white' | 'black',
): Promise<void> {
  const key = `game:${gameId}:presence`;

  await cacheRedis.hset(key, {
    [`${color}Connected`]: 'false',
    [`${color}DisconnectedAt`]: Date.now().toString(),
  });
}

export async function areBothPlayersDisconnected(gameId: string): Promise<boolean> {
  const key = `game:${gameId}:presence`;

  const presence = await cacheRedis.hgetall(key);

  if (presence.whiteConnected !== 'false' || presence.blackConnected !== 'false') {
    return false;
  }

  const whiteDisconnectedAt = Number(presence.whiteDisconnectedAt);
  const blackDisconnectedAt = Number(presence.blackDisconnectedAt);

  if (!whiteDisconnectedAt || !blackDisconnectedAt) return false;

  const fiveMinutes = 5 * 60 * 1000;

  return (
    Date.now() - whiteDisconnectedAt >= fiveMinutes &&
    Date.now() - blackDisconnectedAt >= fiveMinutes
  );
}

export async function cleanupStaleActiveGames(): Promise<void> {
  const activeGames = await prisma.game.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  for (const game of activeGames) {
    const bothDisconnected = await areBothPlayersDisconnected(game.id);

    if (!bothDisconnected) continue;

    await prisma.game.updateMany({
      where: {
        id: game.id,
        status: 'ACTIVE',
      },
      data: {
        status: 'ABANDONED',
        result: 'DRAW',
        reason: 'ABANDONED',
        finishedAt: new Date(),
      },
    });
  }
}

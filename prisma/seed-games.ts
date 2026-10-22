import 'dotenv/config';
import { GameResult, RatingCategory } from '@prisma/client';
import { prisma } from '../src/db/prisma.js';

const TOTAL_GAMES = 100_000;
const BATCH_SIZE = 5_000;

const results: GameResult[] = ['WHITE_WIN', 'BLACK_WIN', 'DRAW'];

const categories: RatingCategory[] = ['BULLET', 'BLITZ', 'RAPID'];

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true },
  });

  if (users.length < 2) {
    throw new Error('Create at least 2 users before running the games seed.');
  }

  console.log(`Seeding ${TOTAL_GAMES} finished games...`);

  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  for (let offset = 0; offset < TOTAL_GAMES; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, TOTAL_GAMES - offset);

    const data = Array.from({ length: count }, (_, i) => {
      const index = offset + i;
      const whiteIndex = index % users.length;

      // Select a different user for Black.
      const blackIndex =
        (whiteIndex + 1 + (Math.floor(index / users.length) % (users.length - 1))) % users.length;

      const createdAt = new Date(now - Math.floor(Math.random() * oneYearMs));

      const durationSeconds = 60 + Math.floor(Math.random() * 1800);
      const finishedAt = new Date(createdAt.getTime() + durationSeconds * 1000);

      const startedAt = new Date(
        finishedAt.getTime() - (30 + Math.floor(Math.random() * 600)) * 1000,
      );

      return {
        whiteId: users[whiteIndex].id,
        blackId: users[blackIndex].id,
        mode: 'PVP' as const,
        status: 'FINISHED' as const,
        rated: true,
        category: categories[index % categories.length],
        baseSeconds: 180,
        incrementSecs: 2,
        result: results[index % results.length],
        reason: 'CHECKMATE' as const,
        createdAt,
        startedAt,
        finishedAt,
      };
    });

    await prisma.game.createMany({ data });

    console.log(`Inserted ${offset + count}/${TOTAL_GAMES}`);
  }

  console.log('Finished seeding games.');
}

main()
  .catch((error) => {
    console.error(error);
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

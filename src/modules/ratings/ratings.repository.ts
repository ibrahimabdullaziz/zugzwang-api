import { Rating, RatingCategory } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type LeaderboardEntry = Rating & {
  user: {
    id: string;
    username: string;
  };
};

export async function getRatingLeaderboard(
  category: RatingCategory,
  limit: number,
  cursor?: string,
): Promise<{ ratings: LeaderboardEntry[]; nextCursor: string | null }> {
  const ratings = await prisma.rating.findMany({
    where: { category },
    include: {
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { value: 'desc' },
  });

  let nextCursor: string | null = null;

  if (ratings.length > limit) {
    ratings.pop();
    nextCursor = ratings[ratings.length - 1]?.id ?? null;
  }

  return { ratings, nextCursor };
}

export async function findRatingHistory(username: string, category: RatingCategory) {
  return prisma.ratingHistory.findMany({
    where: {
      user: {
        username,
      },
      category,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      gameId: true,
      category: true,
      before: true,
      after: true,
      createdAt: true,
    },
  });
}

import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type CreateUserInput = Prisma.UserCreateInput;

export async function create(data: CreateUserInput): Promise<User> {
  return await prisma.user.create({ data });
}

export async function findByEmail(email: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { email } });
}

export async function findByUsername(username: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { username } });
}

export async function findByUsernameWithRatings(username: string) {
  return await prisma.user.findUnique({
    where: { username },
    include: {
      ratings: {
        select: {
          category: true,
          value: true,
          gamesPlayed: true,
        },
      },
    },
  });
}

export async function findById(id: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { id } });
}

export async function findByIdWithRatings(id: string) {
  return await prisma.user.findUnique({
    where: { id },
    include: {
      ratings: {
        select: {
          category: true,
          value: true,
          gamesPlayed: true,
        },
      },
    },
  });
}

export async function updateProfile(id: string, username: string): Promise<User> {
  return await prisma.user.update({
    where: { id },
    data: { username },
  });
}

export async function getUserStats(userId: string) {
  const stats = prisma.$queryRaw`
  SELECT 
    COUNT(*) as total_games,
    COUNT(*) FILTER(WHERE(whiteId=$1 AND result = 'WHITE_WIN') OR WHERE(blackId=$1 AND result = 'BLACK_WIN')) AS wins
    COUNT(*) FILTER (WHERE (white_id = $1 AND result = 'BLACK_WIN') OR (black_id = $1 AND result = 'WHITE_WIN')) AS losses,
    COUNT(*) FILTER(WHERE(result = 'DRAW')) AS draws
    COUNT(*) FILTER (WHERE white_id = $1) AS as_white_total,
    COUNT(*) FILTER (WHERE white_id = $1 AND result = 'WHITE_WIN') AS as_white_wins,
    COUNT(*) FILTER (WHERE black_id = $1) AS as_black_total,
    COUNT(*) FILTER (WHERE black_id = $1 AND result = 'BLACK_WIN') AS as_black_wins,
    AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_duration_seconds

  FROM "Game"
  WHERE whiteId = $1 OR blackId = $1 AND status = 'FINISHED'
  `;

  return stats;
}

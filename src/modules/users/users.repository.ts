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
  return prisma.$queryRaw`
  SELECT
    COUNT(*) AS total_games,
    COUNT(*) FILTER (
      WHERE ("whiteId" = ${userId} AND result = 'WHITE_WIN')
         OR ("blackId" = ${userId} AND result = 'BLACK_WIN')
    ) AS wins,
    COUNT(*) FILTER (
      WHERE ("whiteId" = ${userId} AND result = 'BLACK_WIN')
         OR ("blackId" = ${userId} AND result = 'WHITE_WIN')
    ) AS losses,
    COUNT(*) FILTER (WHERE result = 'DRAW') AS draws,
    COUNT(*) FILTER (WHERE "whiteId" = ${userId}) AS as_white_total,
    COUNT(*) FILTER (
      WHERE "whiteId" = ${userId} AND result = 'WHITE_WIN'
    ) AS as_white_wins,
    COUNT(*) FILTER (WHERE "blackId" = ${userId}) AS as_black_total,
    COUNT(*) FILTER (
      WHERE "blackId" = ${userId} AND result = 'BLACK_WIN'
    ) AS as_black_wins,
    AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt"))) AS avg_duration_seconds
  FROM "Game"
  WHERE ("whiteId" = ${userId} OR "blackId" = ${userId})
    AND status = 'FINISHED'
  `;
}

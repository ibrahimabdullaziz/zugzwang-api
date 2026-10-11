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
    data: { username: username },
  });
}

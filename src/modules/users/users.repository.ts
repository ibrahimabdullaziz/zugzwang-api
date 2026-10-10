import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type CreateUserInput = Prisma.UserCreateInput;
export type UpdateProfileInput = {
  username?: string;
};

export async function create(data: CreateUserInput): Promise<User> {
  return await prisma.user.create({ data });
}

export async function findByEmail(email: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { email } });
}

export async function findByUsername(username: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { username } });
}

export async function findById(id: string): Promise<User | null> {
  return await prisma.user.findUnique({ where: { id } });
}

export async function updateProfile(id: string, data: UpdateProfileInput): Promise<User> {
  return await prisma.user.update({
    where: { id },
    data,
  });
}

import type { CreateUserInput } from './users.schema.js';
import type { User } from '@prisma/client';
import {
  findByEmail as findUserByEmail,
  create as createUser,
  findByUsername as findUserByUsername,
  findByUsernameWithRatings,
  findById as findUserById,
  findByIdWithRatings,
  updateProfile as updateUserProfile,
  getUserStats,
} from './users.repository.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { hashPassword } from '../../common/security/password.js';

export type SafeUser = Omit<User, 'passwordHash'>;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export async function create(data: CreateUserInput): Promise<SafeUser> {
  const { email, password, username } = data;

  const [existingEmail, existingUsername] = await Promise.all([
    findUserByEmail(email),
    findUserByUsername(username),
  ]);

  if (existingEmail) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Email already exists.');
  }

  if (existingUsername) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Username already exists.');
  }

  const hashedPassword = await hashPassword(password);

  const user = await createUser({
    email,
    username,
    passwordHash: hashedPassword,
  });

  return toSafeUser(user);
}

export async function findByEmail(email: string): Promise<User | null> {
  return findUserByEmail(email);
}

export async function findByUsername(username: string): Promise<User | null> {
  return findUserByUsername(username);
}

export async function findById(id: string): Promise<User | null> {
  return findUserById(id);
}

export async function getProfileByUsername(username: string) {
  const user = await findByUsernameWithRatings(username);
  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, `User ${username} not found.`);
  }

  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export async function getProfileById(id: string) {
  const user = await findByIdWithRatings(id);
  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'User not found.');
  }

  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export async function updateProfile(id: string, username: string): Promise<SafeUser> {
  const user = await findById(id);

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'User Not Found.');
  }

  if (username !== user.username) {
    const existing = await findUserByUsername(username);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Username already exists.');
    }
  }

  const updatedUser = await updateUserProfile(id, username);
  return toSafeUser(updatedUser);
}

export async function getUserStatsByUsername(username: string) {
  const user = await findByUsername(username);

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'User Not Found.');
  }

  return await getUserStats(user.id);
}

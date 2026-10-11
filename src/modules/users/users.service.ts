import type { CreateUserInput } from './users.schema.js';
import type { User } from '@prisma/client';
import {
  findByEmail as findUserByEmail,
  create as createUser,
  findByUsername as findUserByUsername,
  findById as findUserById,
  updateProfile as updateUserProfile,
  type UpdateProfileInput,
} from './users.repository.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { hashPassword } from '../../common/security/password.js';

export type SafeUser = Omit<User, 'passwordHash'>;

export async function create(data: CreateUserInput): Promise<SafeUser> {
  const { email, password, username, ...newData } = data;

  const [existingEmail, existingUsername] = await Promise.all([
    findUserByEmail(email),
    username ? findUserByUsername(username) : null,
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
    ...newData,
  });

  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
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

export async function updateProfile(id: string, data: UpdateProfileInput): Promise<SafeUser> {
  const user = await findById(id);

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'User Not Found.');
  }

  const updatedUser = await updateUserProfile(id, data);
  const { passwordHash, ...safeUser } = updatedUser;
  void passwordHash;

  return safeUser;
}

import { User } from '@prisma/client';
import {
  CreateUserInput,
  findByEmail as findUserByEmail,
  create as createUser,
  findByUsername as findUserByUsername,
  findById as findUserById,
  updateProfile as updateUserProfile,
  UpdateProfileInput,
} from './users.repository.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { hashPassword } from '../../common/security/password.js';

type CreateUserServiceInput = Omit<CreateUserInput, 'passwordHash'> & {
  password: string;
};

export async function create(data: CreateUserServiceInput): Promise<User> {
  const { email, password, ...newData } = data;
  if (await findUserByEmail(email)) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Email already exists.');
  }

  const hashedPassword = await hashPassword(password);

  return createUser({ email, passwordHash: hashedPassword, ...newData });
}

export async function findByEmail(email: string): Promise<User | null> {
  return findUserByEmail(email);
}

export async function findByUsername(username: string): Promise<User | null> {
  return findUserByUsername(username);
}

export async function findById(id: string): Promise<User | null> {
  return await findUserById(id);
}

export async function updateProfile(id: string, data: UpdateProfileInput): Promise<User> {
  const user = await findById(id);

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'User Not Found.');
  }

  const updatedUser = await updateUserProfile(id, data);
  return updatedUser;
}

import { randomUUID } from 'node:crypto';
import type { RegisterInputDto, LoginInputDto, verifyEmailDto } from './auth.schema.js';
import { prisma } from '../../db/prisma.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../common/security/tokens.js';
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from '../../common/security/password.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { AuthTokenType, type User } from '@prisma/client';
import { type SafeUser } from '../users/users.service.js';
import type { JobPublisher } from '../../common/queues/Publisher.js';
import { BullMQJobPublisher } from '../../common/queues/BullMQJobPublisher.js';
import { config } from '../../config/env.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

const jobPublisher: JobPublisher = new BullMQJobPublisher();

function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export interface AuthResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

export async function register(dto: RegisterInputDto): Promise<AuthResponse> {
  const { email, username, password } = dto;

  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ]);

  if (existingEmail) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Email already exists.');
  }

  if (existingUsername) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Username already exists.');
  }

  const hashedPassword = await hashPassword(password);
  const plainRefreshToken = generateRefreshToken();
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const verificationToken = generateRefreshToken();
  const verificationTokenHash = hashToken(verificationToken);
  const verificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  const verifyUrl = `${config.app.url}/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;

  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash: hashedPassword,
        ratings: {
          create: [
            { category: 'BULLET', value: 1200 },
            { category: 'BLITZ', value: 1200 },
            { category: 'RAPID', value: 1200 },
          ],
        },
      },
    });

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(plainRefreshToken),
        expiresAt,
      },
    });

    await tx.authToken.create({
      data: {
        userId: user.id,
        type: AuthTokenType.EMAIL_VERIFICATION,
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
      },
    });

    return user;
  });

  await jobPublisher.publishEmail({
    to: email,
    subject: 'Verify Email',
    template: 'verify-email',
    context: { token: verificationToken, username: username, url: verifyUrl },
  });

  const accessToken = signAccessToken(createdUser.id, createdUser.role);

  return {
    user: toSafeUser(createdUser),
    accessToken,
    refreshToken: plainRefreshToken,
  };
}

export async function login(dto: LoginInputDto): Promise<AuthResponse> {
  const { email, password } = dto;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid credentials.');
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid credentials.');
  }

  const plainRefreshToken = generateRefreshToken();
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: hashToken(plainRefreshToken),
      expiresAt,
    },
  });

  const accessToken = signAccessToken(user.id, user.role);

  return {
    user: toSafeUser(user),
    accessToken,
    refreshToken: plainRefreshToken,
  };
}

export async function refreshTokens(
  refreshTokenInput: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshTokenInput) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Refresh token is required.');
  }

  const hashedToken = hashToken(refreshTokenInput);
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashedToken },
  });

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or expired refresh token.');
  }

  if (tokenRecord.revokedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: {
        familyId: tokenRecord.familyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      401,
      'Refresh token reuse detected. Family revoked.',
    );
  }

  const nextRefreshToken = generateRefreshToken();
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: tokenRecord.userId,
        familyId: tokenRecord.familyId,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: nextExpiresAt,
      },
    }),
  ]);

  const user = await prisma.user.findUnique({
    where: { id: tokenRecord.userId },
  });

  if (!user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User no longer exists.');
  }

  const accessToken = signAccessToken(user.id, user.role);

  return {
    accessToken,
    refreshToken: nextRefreshToken,
  };
}

export async function logout(refreshTokenInput: string): Promise<void> {
  if (!refreshTokenInput) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Refresh token is required.');
  }

  const hashedToken = hashToken(refreshTokenInput);
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashedToken },
  });

  if (!tokenRecord) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid refresh token.');
  }

  if (tokenRecord.revokedAt === null) {
    await prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function verifyEmail(dto: verifyEmailDto): Promise<void> {
  const tokenHash = hashToken(dto.token);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const token = await tx.authToken.findFirst({
      where: {
        tokenHash: tokenHash,
        type: AuthTokenType.EMAIL_VERIFICATION,
        expiresAt: { gt: now },
      },
    });

    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid Token');
    }

    const tokenCounter = await tx.authToken.deleteMany({
      where: {
        tokenHash: tokenHash,
        type: AuthTokenType.EMAIL_VERIFICATION,
        expiresAt: { gt: now },
        id: token.id,
      },
    });

    if (tokenCounter.count !== 1) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid Token');
    }

    await tx.user.updateMany({
      where: { id: token.userId, emailVerifiedAt: null },
      data: {
        emailVerifiedAt: now,
      },
    });
  });
}

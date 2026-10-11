import { SafeUser } from './../users/users.service';
import { RegisterInputDto, LoginInputDto } from './auth.schema.js';
import { create } from '../users/users.service.js';
import { prisma } from '../../db/prisma.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../common/security/tokens.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { findByEmail } from '../users/users.repository.js';
import { verifyPassword } from '../../common/security/password.js';
import { findById } from '../users/users.service.js';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=1,t=3$yxXXOisBBFoLr4DJrVi/gg$4bnzwNg8Q6LKoSA92UNvQyvjCqNS3YtAy1qww8X/VUg';

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
  accessToken: string;
  refreshToken: string;
}

export async function register(dto: RegisterInputDto): Promise<AuthResponse> {
  const user = await create(dto);

  await prisma.$transaction([
    prisma.rating.create({ data: { category: 'BULLET', userId: user.id } }),
    prisma.rating.create({ data: { category: 'BLITZ', userId: user.id } }),
    prisma.rating.create({ data: { category: 'RAPID', userId: user.id } }),
  ]);

  const accessToken = signAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.updateMany({
    where: { userId: user.id },
    data: { tokenHash: hashToken(refreshToken) },
  });
  return {
    user,
    accessToken,
    refreshToken,
  };
}

export async function login(dto: LoginInputDto): Promise<SafeUser> {
  const { email, password } = dto;
  const user = await findByEmail(email);

  const passwordToVerify = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
  const checkPassword = await verifyPassword(password, passwordToVerify);

  if (!user || !checkPassword) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid credentials.');
  }

  const accessToken = signAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.updateMany({
    where: { userId: user.id },
    data: { tokenHash: hashToken(refreshToken) },
  });

  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return {
    safeUser,
    accessToken,
    refreshToken,
  };
}

export async function refreshTokens(
  refreshTokenInput: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const authHeader = refreshTokenInput;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }
    const hashedToken = hashToken(token);
    const tokenStatus = await prisma.refreshToken.findFirst({ where: { tokenHash: hashedToken } });

    if (!tokenStatus || tokenStatus.expiresAt < new Date()) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }

    if (tokenStatus.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: tokenStatus.familyId },
        data: { revokedAt: new Date() },
      });

      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }

    await prisma.refreshToken.update({
      where: { id: tokenStatus.id },
      data: { revokedAt: new Date() },
    });

    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.updateMany({
      where: { familyId: tokenStatus.familyId },
      data: { tokenHash: refreshToken },
    });

    const user = await findById(tokenStatus.userId);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }

    const accessToken = signAccessToken(tokenStatus.userId, user.role);
    return { accessToken, refreshToken };
  } else {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
  }
}

export async function logout(refreshTokenInput: string): Promise<void> {
  const authHeader = refreshTokenInput;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }

    const hashedToken = hashToken(token);
    const tokenStatus = await prisma.refreshToken.findFirst({ where: { tokenHash: hashedToken } });

    if (!tokenStatus) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }

    if (tokenStatus.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: tokenStatus.familyId },
        data: { revokedAt: new Date() },
      });
    } else {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid token credentials.');
    }
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId: userId },
    data: {
      revokedAt: new Date(),
    },
  });
}

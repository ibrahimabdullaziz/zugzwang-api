import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/codes.js';
import { randomBytes, createHash } from 'node:crypto';
import { Role } from '@prisma/client';

type AccessTokenClaims = {
  sub: string;
  role: Role;
};

function isRole(value: unknown): value is Role {
  return Object.values(Role).some((role) => role === value);
}

function unauthorizedTokenError(): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or expired access token.');
}

export function signAccessToken(userId: string, role: Role): string {
  try {
    const token = jwt.sign({ sub: userId, role }, config.jwt.accessSecret, {
      expiresIn: '15m',
      algorithm: 'HS256',
    });

    return token;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });

    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      !isRole(decoded.role)
    ) {
      throw unauthorizedTokenError();
    }

    return { sub: decoded.sub, role: decoded.role };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    if (err instanceof jwt.JsonWebTokenError) {
      throw unauthorizedTokenError();
    }

    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

export function generateRefreshToken() {
  try {
    return randomBytes(32).toString('base64url');
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

export function hashToken(token: string) {
  try {
    return createHash('sha256').update(token).digest('hex');
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

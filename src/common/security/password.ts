import * as argon2 from 'argon2';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/codes.js';
import { logger } from '../../config/logger.js';

export async function hashPassword(password: string): Promise<string> {
  try {
    const hashedPassword = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });

    return hashedPassword;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const isMatch = await argon2.verify(password, hash);

    return isMatch;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal Server Error.');
  }
}

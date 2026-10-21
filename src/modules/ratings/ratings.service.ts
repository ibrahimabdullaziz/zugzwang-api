import { RatingCategory } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { getRatingLeaderboard } from './ratings.repository.js';

const VALID_CATEGORIES: RatingCategory[] = ['BULLET', 'BLITZ', 'RAPID'];

export async function getLeaderboard(
  category: string = 'BLITZ',
  limit: string = '20',
  cursor?: string,
) {
  if (!VALID_CATEGORIES.includes(category as RatingCategory)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid rating category');
  }

  const convertedLimit = Number(limit);

  if (!Number.isInteger(convertedLimit) || convertedLimit < 1 || convertedLimit > 100) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      400,
      'Limit must be an integer between 1 and 100',
    );
  }

  const result = await getRatingLeaderboard(category as RatingCategory, convertedLimit, cursor);

  return result;
}

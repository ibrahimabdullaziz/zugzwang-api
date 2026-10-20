import { RatingCategory } from '@prisma/client';

interface TimeControl {
  baseSeconds: number;
  incrementSecs: number;
}

export function determineRatingCategory(timeControl: TimeControl): RatingCategory {
  const estimatedSeconds = timeControl.baseSeconds + 40 * timeControl.incrementSecs;

  if (estimatedSeconds < 180) {
    return RatingCategory.BULLET;
  }

  if (estimatedSeconds < 600) {
    return RatingCategory.BLITZ;
  }

  return RatingCategory.RAPID;
}

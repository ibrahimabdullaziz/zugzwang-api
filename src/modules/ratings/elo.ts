export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

export function getKFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 30) return 40;
  if (rating <= 2400) return 20;
  return 10;
}

export function calculateEloChange(
  rating: number,
  opponentRating: number,
  gamesPlayed: number,
  actualScore: 0 | 0.5 | 1,
): number {
  const expected = expectedScore(rating, opponentRating);
  const k = getKFactor(rating, gamesPlayed);
  const deltaRating = Math.round(k * (actualScore - expected));

  return Math.max(100, rating + deltaRating);
}

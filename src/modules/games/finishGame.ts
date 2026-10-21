import { Game, GameMode, GameResult, GameStatus } from '@prisma/client';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { prisma } from '../../db/prisma.js';
import { FinishGameData } from '../chess/types.js';
import { calculateEloChange } from '../ratings/elo.js';

type FinishGameResult = {
  game: Game;
  finishedNow: boolean;
};

export async function finishGame(gameId: string, data: FinishGameData): Promise<FinishGameResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Game[]>`
      SELECT *
      FROM "Game"
      WHERE id = ${gameId}
      FOR UPDATE
    `;

    const game = rows[0];

    if (!game) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'This game is not found');
    }

    if (game.status === GameStatus.FINISHED || game.status === GameStatus.ABANDONED) {
      return { game, finishedNow: false };
    }

    let whiteRatingBefore: number | null = null;
    let whiteRatingAfter: number | null = null;
    let blackRatingBefore: number | null = null;
    let blackRatingAfter: number | null = null;

    const shouldRate =
      data.status === GameStatus.FINISHED &&
      game.mode === GameMode.PVP &&
      game.rated &&
      game.whiteId !== null &&
      game.blackId !== null &&
      game.category !== null;

    if (shouldRate) {
      const userIds = [game.whiteId!, game.blackId!].sort();

      const ratings = await tx.$queryRaw<
        Array<{
          id: string;
          userId: string;
          category: string;
          value: number;
          gamesPlayed: number;
        }>
      >`
        SELECT id, "userId", category, value, "gamesPlayed"
        FROM "Rating"
        WHERE "userId" IN (${userIds[0]}, ${userIds[1]})
          AND category = ${game.category}
        ORDER BY "userId"
        FOR UPDATE
      `;

      const whiteRating = ratings.find((rating) => rating.userId === game.whiteId);
      const blackRating = ratings.find((rating) => rating.userId === game.blackId);

      if (!whiteRating || !blackRating) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Player rating is not found');
      }

      let whiteScore: 0 | 0.5 | 1;
      let blackScore: 0 | 0.5 | 1;

      if (data.result === GameResult.WHITE_WIN) {
        whiteScore = 1;
        blackScore = 0;
      } else if (data.result === GameResult.BLACK_WIN) {
        whiteScore = 0;
        blackScore = 1;
      } else {
        whiteScore = 0.5;
        blackScore = 0.5;
      }

      whiteRatingBefore = whiteRating.value;
      blackRatingBefore = blackRating.value;

      whiteRatingAfter = calculateEloChange(
        whiteRating.value,
        blackRating.value,
        whiteRating.gamesPlayed,
        whiteScore,
      );

      blackRatingAfter = calculateEloChange(
        blackRating.value,
        whiteRating.value,
        blackRating.gamesPlayed,
        blackScore,
      );

      await tx.rating.update({
        where: { id: whiteRating.id },
        data: {
          value: whiteRatingAfter,
          gamesPlayed: { increment: 1 },
        },
      });

      await tx.rating.update({
        where: { id: blackRating.id },
        data: {
          value: blackRatingAfter,
          gamesPlayed: { increment: 1 },
        },
      });

      await tx.ratingHistory.createMany({
        data: [
          {
            userId: game.whiteId!,
            gameId: game.id,
            category: game.category!,
            before: whiteRatingBefore,
            after: whiteRatingAfter,
          },
          {
            userId: game.blackId!,
            gameId: game.id,
            category: game.category!,
            before: blackRatingBefore,
            after: blackRatingAfter,
          },
        ],
      });
    }

    const updatedGame = await tx.game.update({
      where: { id: gameId },
      data: {
        ...data,
        finishedAt: new Date(),
        whiteRatingBefore,
        whiteRatingAfter,
        blackRatingBefore,
        blackRatingAfter,
      },
    });

    if (updatedGame.status === 'WAITING') {
      throw new AppError(ErrorCode.CONFLICT, 409, 'The game still in progress');
    }

    return {
      game: updatedGame,
      finishedNow: true,
    };
  });
}

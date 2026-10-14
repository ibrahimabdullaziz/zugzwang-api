import { Chess, Color } from 'chess.js';
import { OutCome, TimeControl } from '../chess/types.js';
import {
  create,
  findActiveByUser,
  findById,
  findByInviteCode,
  finish,
  joinGameConditional,
} from './games.repository.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { Game, RatingCategory } from '@prisma/client';
import { nanoid } from 'zod';
import { buildPgn } from '../chess/pgn.js';

function determineRatingCategory(timeControl: TimeControl): RatingCategory {
  const estimatedSeconds: number = timeControl.baseSeconds + 40 * timeControl.incrementSecs;

  if (estimatedSeconds <= 180) {
    return RatingCategory.BULLET;
  } else if (estimatedSeconds < 600) {
    return RatingCategory.BLITZ;
  } else {
    return RatingCategory.RAPID;
  }
}

export async function createChallenge(
  userId: string,
  timeControl: TimeControl,
  color?: Color,
  rated?: boolean,
) {
  if (await findActiveByUser(userId)) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'You already have an active game');
  }

  const ratingCategory = determineRatingCategory(timeControl);
  let whiteId = null;
  let blackId = null;

  if (color === 'w') {
    whiteId = userId;
  } else {
    blackId = userId;
  }

  const inviteCode = nanoid('invite code');

  return create({
    category: ratingCategory,
    mode: 'PVP',
    status: 'WAITING',
    ...timeControl,
    rated,
    inviteCode,
    white: whiteId,
    black: blackId,
  });
}

export async function joinByCode(userId: string, code: string): Promise<Game | null> {
  const game = await findByInviteCode(code);
  if (!game) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not Found');
  }

  if (game.whiteId === userId || game.blackId === userId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'you are forbidden from this action');
  }

  if (await findActiveByUser(userId)) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'you already in active game');
  }

  const confirmedGame = await joinGameConditional(game.id);
  return confirmedGame;
}

export async function resign(userId: string, gameId: string) {
  const game = await findById(gameId);

  if (!game) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not Found');
  }

  if (game.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.NOT_FOUND, 400, 'game is not active');
  }

  if (userId !== game.whiteId || userId !== game.blackId) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 403, 'You are not Authorized');
  }

  const outCome: OutCome = {
    result: userId === game.whiteId ? 'BLACK_WIN' : 'WHITE_WIN',
    reason: 'RESIGNATION',
  };

  const pgn = buildPgn({
    white: game.whiteId,
    black: game.blackId,
    date: game.createdAt,
    result: outCome.result,
    reason: outCome.reason,
    timeControl: {
      baseSeconds: game.baseSeconds,
      incrementSecs: game.incrementSecs,
    },
    moves: [],
  });

  return await finish(gameId, {
    status: 'FINISHED',
    ...outCome,
    pgn,
    finalFen: new Chess().fen(),
  });
}

export async function abort(userId: string, gameId: string) {
  const game = await findById(gameId);

  if (!game) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Not Found');
  }

  if (game.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.NOT_FOUND, 400, 'game is not active');
  }

  if (userId !== game.whiteId || userId !== game.blackId) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 403, 'You are not Authorized');
  }

  const recordedMoves = new Chess();
  if (game.pgn) {
    recordedMoves.loadPgn(game.pgn);
  }

  if (recordedMoves.history().length <= 1) {
    const outCome: OutCome = {
      result: 'DRAW',
      reason: 'ABORTION',
    };

    const pgn = buildPgn({
      white: game.whiteId,
      black: game.blackId,
      date: game.createdAt,
      result: outCome.result,
      reason: outCome.reason,
      timeControl: {
        baseSeconds: game.baseSeconds,
        incrementSecs: game.incrementSecs,
      },
      moves: [],
    });

    return finish(gameId, {
      status: 'FINISHED',
      ...outCome,
      pgn,
      finalFen: new Chess().fen(),
    });
  }
}

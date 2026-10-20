import { Chess, Color } from 'chess.js';
import { ChessGame } from '../chess/chessGame.js';
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
import { Game } from '@prisma/client';
import { buildPgn } from '../chess/pgn.js';
import { nanoid } from 'nanoid';
import { INVITE_CODE_LENGTH } from './games.schema.js';
import { determineRatingCategory } from '../ratings/category.js';

export async function getGame(gameId: string) {
  const game = await findById(gameId, true);

  if (!game) {
    throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
  }

  return game;
}

export async function getGameMoves(gameId: string) {
  const game = (await findById(gameId, true)) as (Game & { moves: unknown[] }) | null;

  if (!game) {
    throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
  }

  return game.moves;
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
  const chosenColor: Color = color ?? (Math.random() < 0.5 ? 'w' : 'b');
  const whiteId = chosenColor === 'w' ? userId : null;
  const blackId = chosenColor === 'b' ? userId : null;

  const inviteCode = nanoid(INVITE_CODE_LENGTH);

  return create({
    category: ratingCategory,
    mode: 'PVP',
    status: 'WAITING',
    ...timeControl,
    rated,
    inviteCode,
    white: whiteId ? { connect: { id: whiteId } } : undefined,
    black: blackId ? { connect: { id: blackId } } : undefined,
  });
}

export async function joinByCode(userId: string, code: string): Promise<Game | null> {
  const game = await findByInviteCode(code);
  if (!game) {
    throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
  }

  if (game.status !== 'WAITING') {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Game is not waiting for players');
  }

  if (game.whiteId === userId || game.blackId === userId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'You cannot join your own game');
  }

  if (await findActiveByUser(userId)) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'You already have an active game');
  }

  const slot = game.whiteId ? 'blackId' : 'whiteId';
  const confirmedGame = await joinGameConditional(game.id, slot, userId);
  return confirmedGame;
}

export async function resign(userId: string, gameId: string) {
  const game = (await findById(gameId, true)) as
    | (Game & {
        moves?: { uci: string; san: string }[];
        white?: { id: string; username: string } | null;
        black?: { id: string; username: string } | null;
      })
    | null;

  if (!game) {
    throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
  }

  if (game.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.GAME_IN_PROGRESS, 400, 'Game is not active');
  }

  if (userId !== game.whiteId && userId !== game.blackId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'You are not a participant in this game');
  }

  if (!game.whiteId || !game.blackId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Game participants are missing');
  }

  const outCome: OutCome = {
    result: userId === game.whiteId ? 'BLACK_WIN' : 'WHITE_WIN',
    reason: 'RESIGNATION',
  };

  const movesList = game.moves ?? [];
  const chess = ChessGame.fromMoves(movesList.map((m) => m.uci));

  const pgn = buildPgn({
    white: game.white?.username ?? game.whiteId,
    black: game.black?.username ?? game.blackId,
    date: game.createdAt,
    result: outCome.result,
    reason: outCome.reason,
    timeControl: {
      baseSeconds: game.baseSeconds,
      incrementSecs: game.incrementSecs,
    },
    moves: movesList.map((m) => m.san),
  });

  return await finish(gameId, {
    status: 'FINISHED',
    ...outCome,
    pgn,
    finalFen: chess.fen,
  });
}

export async function abort(userId: string, gameId: string) {
  const game = (await findById(gameId, true)) as
    | (Game & {
        moves?: { uci: string; san: string }[];
        white?: { id: string; username: string } | null;
        black?: { id: string; username: string } | null;
      })
    | null;

  if (!game) {
    throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
  }

  if (game.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.GAME_IN_PROGRESS, 400, 'Game is not active');
  }

  if (userId !== game.whiteId && userId !== game.blackId) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'You are not a participant in this game');
  }

  if (!game.whiteId || !game.blackId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Game participants are missing');
  }

  if (game.moves && game.moves.length > 0) {
    throw new AppError(
      ErrorCode.GAME_IN_PROGRESS,
      400,
      'Game can only be aborted before the first move has been made',
    );
  }

  const outCome: OutCome = {
    result: 'DRAW',
    reason: 'ABANDONED',
  };

  const pgn = buildPgn({
    white: game.white?.username ?? game.whiteId,
    black: game.black?.username ?? game.blackId,
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
    status: 'ABANDONED',
    ...outCome,
    pgn,
    finalFen: new Chess().fen(),
  });
}

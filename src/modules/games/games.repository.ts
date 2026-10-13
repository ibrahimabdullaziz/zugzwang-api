import { Game, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { FinishGameData } from '../chess/types.js';

export async function create(data: Game): Promise<Game | null> {
  return await prisma.game.create({
    data: data,
  });
}

export async function findById(id: string, includeMoves = false): Promise<Game | null> {
  return await prisma.game.findFirst({
    where: { id },
    include: {
      white: true,
      black: true,
      moves: includeMoves ? { orderBy: { ply: 'asc' } } : false,
    },
  });
}

export async function findByInviteCode(code: string): Promise<Game | null> {
  return await prisma.game.findFirst({
    where: { inviteCode: code },
  });
}

export async function listByUser(userId: string, params: { cursor?: string; limit?: number }) {
  const take = params.limit || 10;
  const games = await prisma.game.findMany({
    where: { OR: [{ blackId: userId }, { whiteId: userId }] },
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
  });

  let nextCursor: string | null = null;

  if (games.length > take) {
    const nextItem = games.pop();
    nextCursor = nextItem?.id ?? null;
  }

  return { games, nextCursor };
}

export async function appendMove(
  gameId: string,
  moveData: Prisma.MoveCreateInput,
  gameUpdate: Prisma.GameUpdateInput,
): Promise<Game | null> {
  return await prisma.$transaction(async (tx) => {
    await tx.move.create({
      data: {
        ...moveData,
        game: { connect: { id: gameId } },
      },
    });

    return await tx.game.update({
      where: { id: gameId },
      data: gameUpdate,
    });
  });
}

export async function finish(gameId: string, data: FinishGameData): Promise<Game | null> {
  return await prisma.$transaction(async (tx) => {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Game not found');
    }
    if (game.status === 'ACTIVE') {
      throw new AppError(ErrorCode.GAME_IN_PROGRESS, 400, 'game still active');
    }
    return await tx.game.update({
      where: { id: gameId },
      data: {
        ...data,
        finishedAt: new Date(),
      },
    });
  });
}

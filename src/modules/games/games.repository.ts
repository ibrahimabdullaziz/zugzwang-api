import { Game, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';

export async function create(data: Prisma.GameCreateInput): Promise<Game | null> {
  return await prisma.game.create({
    data: data,
  });
}

export async function findById(id: string, includeMoves = false): Promise<Game | null> {
  return await prisma.game.findUnique({
    where: { id },
    include: {
      white: { select: { id: true, username: true } },
      black: { select: { id: true, username: true } },
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

export async function findActiveByUser(userId: string): Promise<Game | null> {
  return await prisma.game.findFirst({
    where: {
      AND: [
        { OR: [{ whiteId: userId }, { blackId: userId }] },
        { OR: [{ status: 'ACTIVE' }, { status: 'WAITING' }] },
      ],
    },
  });
}

export async function joinGameConditional(
  gameId: string,
  slot: 'whiteId' | 'blackId',
  userId: string,
): Promise<Game | null> {
  return await prisma.$transaction(async (tx) => {
    const result = await tx.game.updateMany({
      where: { id: gameId, status: 'WAITING', [slot]: null },
      data: {
        [slot]: userId,
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Game has already been joined');
    }

    return await tx.game.findUnique({
      where: { id: gameId },
      include: {
        white: { select: { id: true, username: true } },
        black: { select: { id: true, username: true } },
      },
    });
  });
}

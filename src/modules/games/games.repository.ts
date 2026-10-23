import { Game, Prisma, RatingCategory } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

type PaginationParams = {
  cursor?: string;
  limit?: number;
  result?: 'W' | 'L' | 'D';
  color?: 'w' | 'b';
  category?: RatingCategory;
};

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

export async function listByUser(userId: string, params: PaginationParams) {
  const take = params.limit || 10;

  let where: Prisma.GameWhereInput;

  if (params.color === 'w') {
    where = {
      whiteId: userId,
    };
  } else if (params.color === 'b') {
    where = {
      blackId: userId,
    };
  } else {
    where = {
      OR: [{ blackId: userId }, { whiteId: userId }],
    };
  }

  if (params.category) {
    where = { ...where, category: params.category };
  }
  if (params.result === 'D') {
    where = {
      ...where,
      result: 'DRAW',
    };
  } else if (params.result) {
    const whiteResult = params.result === 'W' ? 'WHITE_WIN' : 'BLACK_WIN';
    const blackResult = params.result === 'W' ? 'BLACK_WIN' : 'WHITE_WIN';

    if (params.color === 'w') {
      where = { ...where, result: whiteResult };
    } else if (params.color === 'b') {
      where = { ...where, result: blackResult };
    } else {
      where = {
        ...where,
        OR: [
          { whiteId: userId, result: whiteResult },
          { blackId: userId, result: blackResult },
        ],
      };
    }
  }
const decodedCursor = params.cursor
  ? decodeCursor(params.cursor)
  : undefined;

const query: Prisma.GameFindManyArgs = {
  where: {
    AND: [
      where,
      ...(decodedCursor
        ? [
            {
              OR: [
                { createdAt: { lt: decodedCursor.createdAt } },
                {
                  createdAt: decodedCursor.createdAt,
                  id: { lt: decodedCursor.id },
                },
              ],
            },
          ]
        : []),
    ],
  },
  take: take + 1,
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
};

const games = await prisma.game.findMany(query);

let nextCursor: string | null = null;

if (games.length > take) {
  games.pop();

  const lastGame = games[games.length - 1];

  if (lastGame) {
    nextCursor = encodeCursor({
      createdAt: lastGame.createdAt,
      id: lastGame.id,
    });
  }
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

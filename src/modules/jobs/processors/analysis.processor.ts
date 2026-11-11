import type { Job } from 'bullmq';
import type { AnalysisJobPayload } from '../../../config/queues.js';
import { prisma } from '../../../db/prisma.js';

const STALE_AFTER_MS = 5 * 60 * 1000;

import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/AppError.js';
import { ErrorCode } from '../../../common/errors/codes.js';

async function claimAnalysis(gameId: string): Promise<string | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const leaseToken = randomUUID();

  const result = await prisma.gameAnalysis.updateMany({
    where: {
      gameId,
      OR: [
        { status: 'PENDING' },
        {
          status: 'RUNNING',
          startedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: 'RUNNING',
      startedAt: now,
      leaseToken,
      failureReason: null,
    },
  });

  return result.count === 1 ? leaseToken : null;
}

export async function analysisProcessor(job: Job<AnalysisJobPayload>): Promise<void> {
  const { gameId } = job.data;

  const analysis = await prisma.gameAnalysis.findUnique({
    where: { gameId },
  });

  if (!analysis) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, `Analysis for game ${gameId} not found`);
  }

  if (analysis.status === 'DONE') return;

  const leaseToken = await claimAnalysis(gameId);

  if (!leaseToken) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'Analysis is already claimed');
  }

  // TODO: Run Stockfish.

  //   await prisma.$transaction(async (tx) => {
  //     const ownership = await tx.gameAnalysis.findFirst({
  //       where: {
  //         id: analysis.id,
  //         status: 'RUNNING',
  //         leaseToken,
  //       },
  //       select: { id: true },
  //     });

  //     if (!ownership) {
  //       throw new AppError(ErrorCode.CONFLICT, 409, 'Analysis lease lost');
  //     }

  //     await tx.moveAnalysis.createMany({
  //       data: moveResults.map((move) => ({
  //         analysisId: analysis.id,
  //         ...move,
  //       })),
  //     });

  //     const completed = await tx.gameAnalysis.updateMany({
  //       where: {
  //         id: analysis.id,
  //         status: 'RUNNING',
  //         leaseToken,
  //       },
  //       data: {
  //         status: 'DONE',
  //         completedAt: new Date(),
  //         accuracyWhite,
  //         accuracyBlack,
  //         leaseToken: null,
  //       },
  //     });

  //     if (completed.count !== 1) {
  //       throw new AppError(ErrorCode.CONFLICT, 409, 'Analysis lease lost');
  //     }
  //   });
}

import type { Server } from 'socket.io';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { create, findActiveByUser } from '../games/games.repository.js';
import { determineRatingCategory } from '../ratings/category.js';
import { findByIdWithRatings } from '../users/users.repository.js';
import type { MatchMaker, QueueEntry } from './matchmaker.js';
import { logger } from '../../config/logger.js';

export class MatchMaking {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private matchMaker: MatchMaker,
    private io: Server,
  ) {}

  public start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      if (this.isProcessing) return;

      this.isProcessing = true;

      void this.processMatches()
        .catch((error: unknown) => {
          logger.error({ component: error }, 'Failed to process matches');
        })
        .finally(() => {
          this.isProcessing = false;
        });
    }, 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async joinQueue(
    userId: string,
    socketId: string,
    timeControl: { baseSeconds: number; incrementSecs: number },
  ) {
    if (await this.matchMaker.isQueued(userId)) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'This user has been already queued');
    }

    if (await findActiveByUser(userId)) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'You already have an active game');
    }

    const ratingCategory = determineRatingCategory(timeControl);

    const user = await findByIdWithRatings(userId);
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'User not found');
    }

    const queueEntry: QueueEntry = {
      userId: user.id,
      socketId,
      timeControl,
      category: ratingCategory,
      rating: user.ratings?.find((rating) => rating.category === ratingCategory)?.value || 1200,
      joinedAt: Date.now(),
    };

    this.matchMaker.enqueue(queueEntry);
  }

  public async leaveQueue(userId: string) {
    await this.matchMaker.dequeue(userId);
  }

  async processMatches() {
    const pairs = await this.matchMaker.tick();
    if (!pairs || pairs.length === 0) {
      return;
    }

    for (const pair of pairs) {
      const isP1White = Math.random() < 0.5;
      const [player1, player2] = Object.values(pair) as [QueueEntry, QueueEntry];

      const whiteId = isP1White ? player1.userId : player2.userId;
      const blackId = isP1White ? player2.userId : player1.userId;

      const game = await create({
        mode: 'PVP',
        status: 'ACTIVE',
        white: { connect: { id: whiteId } },
        black: { connect: { id: blackId } },
        baseSeconds: player1.timeControl.baseSeconds,
        incrementSecs: player1.timeControl.incrementSecs,
        category: player1.category,
        startedAt: new Date(),
      });

      if (!game) continue;

      this.io.to(player1.socketId).emit('queue:matched', { gameId: game.id });
      this.io.to(player2.socketId).emit('queue:matched', { gameId: game.id });
    }
  }
}

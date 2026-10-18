import { socketServer } from 'socket.io';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { create, findActiveByUser } from '../games/games.repository.js';
import { determineRatingCategory } from '../games/games.service.js';
import { findByIdWithRatings } from '../users/users.repository.js';
import type { MatchMaker, QueueEntry } from './matchmaker.js';

export class MatchMaking {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private MatchMaker: MatchMaker,
    private io: socketServer,
  ) {}

  public start() {
    if (this.intervalId) return;
    setInterval(() => {
      return this.processMatches();
    }, 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async enqueueRules(data: QueueEntry, matchMaker: MatchMaker) {
    if (matchMaker.isQueued(data.userId)) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'This user has been already queued');
    }

    if (await findActiveByUser(data.userId)) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'You already have an active game');
    }

    const ratingCategory = determineRatingCategory(data.timeControl);

    const user = await findByIdWithRatings(data.userId);
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'User not found');
    }

    const queueEntry = { ...data, ratingCategory, userId: user.id };
    matchMaker.enqueue(queueEntry);
  }

  async processMatches() {
    const pairs = this.MatchMaker.trick();
    if (!pairs || pairs.length === 0) {
      return;
    }

    const isP1White = Math.random() < 0.5;
    const whiteId = isP1White ? pairs.p1.userId : pairs.p2.userId;
    const blackId = isP1White ? pairs.p2.userId : pairs.p1.userId;

    const game = create({
      mode: 'PVP',
      status: 'ACTIVE',
      white: whiteId,
      black: blackId,
      baseSeconds: pairs.p1.timeControl.baseSeconds,
      incrementSecs: pairs.p1.timeControl.incrementSecs,
      category: pairs.p1.timeControl.category,
      startedAt: new Date(),
    });

    this.io.to(pairs.p1.socketId).emit('game:join', { gameId: game.id });
    this.io.to(pairs.p2.socketId).emit('game:join', { gameId: game.id });
  }
}

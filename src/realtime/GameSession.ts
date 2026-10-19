import { Game, GameResult, ResultReason } from '@prisma/client';
import type { Server } from 'socket.io';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import { ChessGame } from '../modules/chess/chessGame.js';
import { isValidUci } from '../modules/chess/uci.js';
import { appendMove, finish } from '../modules/games/games.repository.js';
import { Clock } from '../modules/clocks/clock.js';

export interface GameSessionData {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: { baseSeconds: number; incrementSeconds: number };
  game: Game;
  io: Server;
  gameInstance?: ChessGame;
  initialMoves?: string[];
}

export class GameSession {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: { baseSeconds: number; incrementSeconds: number };
  game: Game;
  gameInstance: ChessGame;

  whiteSocketId?: string;
  blackSocketId?: string;
  spectators: Set<string> = new Set();

  drawOffer: { offeredBy: string | null } = { offeredBy: null };
  disconnectedTimer?: NodeJS.Timeout;

  private io: Server;
  clock: Clock;
  turnTimer?: NodeJS.Timeout;
  private turnStartedAt: number;
  private lastTask: Promise<unknown> = Promise.resolve();

  constructor(data: GameSessionData) {
    this.gameId = data.gameId;
    this.whiteId = data.whiteId;
    this.blackId = data.blackId;
    this.category = data.category;
    this.timeControl = data.timeControl;
    this.game = data.game;

    if (data.gameInstance) {
      this.gameInstance = data.gameInstance;
    } else if (data.initialMoves && data.initialMoves.length > 0) {
      this.gameInstance = ChessGame.fromMoves(data.initialMoves);
    } else {
      this.gameInstance = new ChessGame();
    }

    this.io = data.io;

    this.clock = new Clock(
      this.timeControl.baseSeconds,
      this.timeControl.incrementSeconds,
      this.gameInstance.turn,
    );

    this.turnStartedAt = performance.now();

    if (this.game.status === 'ACTIVE') {
      this.clock.start(this.turnStartedAt);
      this.resetTurnTimer();
    }
  }

  async mutex<T>(task: () => Promise<T>): Promise<T> {
    const currentTask = this.lastTask.then(task, task);
    this.lastTask = currentTask.catch(() => {});
    return currentTask;
  }

  private async finishOnTimeout(): Promise<void> {
    if (this.game.status !== 'ACTIVE') return;

    const timedOutColor = this.gameInstance.turn;
    const opponentColor = timedOutColor === 'w' ? 'b' : 'w';

    const insufficientMaterial = this.gameInstance.isInsufficientMaterial();

    const result: GameResult = insufficientMaterial
      ? 'DRAW'
      : opponentColor === 'w'
        ? 'WHITE_WIN'
        : 'BLACK_WIN';

    const reason: ResultReason = insufficientMaterial ? 'INSUFFICIENT_MATERIAL' : 'TIMEOUT';

    this.game.status = 'FINISHED';

    clearTimeout(this.turnTimer);
    this.turnTimer = undefined;

    clearTimeout(this.disconnectedTimer);
    this.disconnectedTimer = undefined;

    await finish(this.gameId, {
      status: 'FINISHED',
      result,
      reason,
      finalFen: this.gameInstance.fen,
      pgn: '',
    });

    this.io.to(`game:${this.gameId}`).emit('game:over', {
      result,
      reason,
    });
  }

  resetTurnTimer(): void {
    clearTimeout(this.turnTimer);

    if (this.game.status !== 'ACTIVE') {
      this.turnTimer = undefined;
      return;
    }

    const now = performance.now();
    const sideToMove = this.gameInstance.turn;
    const remainingTime = this.clock.getRemainingTime(sideToMove, now);

    if (remainingTime <= 0) {
      this.turnTimer = setTimeout(() => {
        void this.handleTimeout();
      }, 0);

      return;
    }

    this.turnTimer = setTimeout(() => {
      void this.handleTimeout();
    }, remainingTime);
  }

  async handleTimeout(): Promise<void> {
    return this.mutex(async () => {
      if (this.game.status !== 'ACTIVE') return;

      const now = performance.now();
      const timedOutColor = this.gameInstance.turn;
      const remainingTime = this.clock.getRemainingTime(timedOutColor, now);

      if (remainingTime > 0) {
        this.resetTurnTimer();
        return;
      }

      const opponentColor = timedOutColor === 'w' ? 'b' : 'w';

      const result: GameResult = this.gameInstance.isInsufficientMaterial()
        ? opponentColor === 'w'
          ? 'WHITE_WIN'
          : 'BLACK_WIN'
        : 'DRAW';

      const reason: ResultReason = result === 'DRAW' ? 'INSUFFICIENT_MATERIAL' : 'TIMEOUT';

      this.game.status = 'FINISHED';
      clearTimeout(this.turnTimer);
      this.turnTimer = undefined;
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = undefined;

      await finish(this.gameId, {
        status: 'FINISHED',
        result,
        reason,
        finalFen: this.gameInstance.fen,
        pgn: '',
      });

      this.io.to(`game:${this.gameId}`).emit('game:over', {
        result,
        reason,
      });
    });
  }

  async handleMove(userId: string, uci: string) {
    return this.mutex(async () => {
      if (this.game.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Game is not active');
      }

      const sideToMove = this.gameInstance.turn;
      const currentPlayerId = sideToMove === 'w' ? this.whiteId : this.blackId;

      if (currentPlayerId !== userId) {
        throw new AppError(ErrorCode.NOT_YOUR_TURN, 400, 'It is not your turn');
      }

      if (!isValidUci(uci)) {
        throw new AppError(ErrorCode.ILLEGAL_MOVE, 400, 'Invalid UCI formatting');
      }

      const now = performance.now();
      const remainingBeforeMove = this.clock.getRemainingTime(sideToMove, now);

      if (remainingBeforeMove <= 0) {
        await this.finishOnTimeout();
        throw new AppError(ErrorCode.CONFLICT, 409, 'Your clock has expired');
      }

      const timeSpentMs = Math.max(0, now - this.turnStartedAt);

      const moveData = this.gameInstance.applyMove(uci);

      const timedOut = this.clock.completeMove(now);

      if (timedOut) {
        await this.finishOnTimeout();
        throw new AppError(ErrorCode.CONFLICT, 409, 'Your clock has expired');
      }

      const ply = this.gameInstance.history.length;
      const nextColor = this.gameInstance.turn;
      const clockAfterMs = this.clock.getRemainingTime(nextColor, now);

      await appendMove(
        this.gameId,
        {
          ply,
          san: moveData.san,
          uci,
          fenAfter: moveData.fen,
          timeSpentMs: Math.round(timeSpentMs),
          clockAfterMs: Math.round(clockAfterMs),
          game: { connect: { id: this.gameId } },
        },
        {},
      );

      this.drawOffer.offeredBy = null;

      const outcome = this.gameInstance.getOutcome();

      if (outcome?.result) {
        this.game.status = 'FINISHED';
        clearTimeout(this.turnTimer);
        this.turnTimer = undefined;
        clearTimeout(this.disconnectedTimer);
        this.disconnectedTimer = undefined;

        await finish(this.gameId, {
          status: 'FINISHED',
          result: outcome.result,
          reason: outcome.reason,
          finalFen: moveData.fen,
          pgn: '',
        });

        this.io.to(`game:${this.gameId}`).emit('game:over', {
          result: outcome.result,
          reason: outcome.reason,
        });
      } else {
        this.turnStartedAt = now;
        this.resetTurnTimer();
      }

      return { ply, ...moveData, uci, outcome };
    });
  }

  async resign(userId: string) {
    let outcome: { result: GameResult; reason: ResultReason };
    if (userId === this.whiteId) {
      outcome = {
        result: 'BLACK_WIN',
        reason: 'RESIGNATION',
      };
    } else if (userId === this.blackId) {
      outcome = {
        result: 'WHITE_WIN',
        reason: 'RESIGNATION',
      };
    } else {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don`t have access to do this');
    }

    await finish(this.gameId, {
      status: 'FINISHED',
      result: outcome.result,
      reason: outcome.reason,
      finalFen: this.gameInstance.fen,
      pgn: '',
    });
    return outcome;
  }

  async handleDrawOffer(userId: string) {
    if (userId !== this.blackId && userId !== this.whiteId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don`t have access to do this');
    }
    this.drawOffer.offeredBy = userId;
  }

  async handleDrawAccept(userId: string) {
    if (this.drawOffer.offeredBy === null || this.drawOffer.offeredBy === userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don`t have access to do this');
    }

    return await finish(this.gameId, {
      status: 'FINISHED',
      result: 'DRAW',
      reason: 'DRAW_AGREEMENT',
      finalFen: this.gameInstance.fen,
      pgn: '',
    });
  }

  async handleDrawDecline(userId: string) {
    if (this.drawOffer.offeredBy === null || this.drawOffer.offeredBy === userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don`t have access to do this');
    }

    this.drawOffer.offeredBy = null;
  }

  async handleDisconnect(socketId: string, io: Server) {
    const isWhite = socketId === this.whiteSocketId;
    const isBlack = socketId === this.blackSocketId;

    if (!isWhite && !isBlack) return;

    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer);
    }

    io.to(`game:${this.gameId}`).emit('game:opponent:disconnected', { graceSeconds: 30 });

    this.disconnectedTimer = setTimeout(async () => {
      if (this.game.status !== 'ACTIVE') return;

      this.game.status = 'FINISHED';
      const result = isWhite ? 'BLACK_WIN' : 'WHITE_WIN';

      await finish(this.gameId, {
        status: 'FINISHED',
        result: result,
        reason: 'ABANDONED',
        finalFen: this.gameInstance.fen,
        pgn: '',
      });

      io.to(`game:${this.gameId}`).emit('game:over', {
        result: result,
        reason: 'ABANDONED',
      });
    }, 30_000);
  }

  async handleReconnect(userId: string, socketId: string, io: Server) {
    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = undefined;
      io.to(`game:${this.gameId}`).emit('game:opponent:reconnected');
    }

    if (userId === this.whiteId) this.whiteSocketId = socketId;
    if (userId === this.blackId) this.blackSocketId = socketId;
  }
}

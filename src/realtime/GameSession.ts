import { Game, GameResult, ResultReason } from '@prisma/client';
import type { Server } from 'socket.io';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import { ChessGame } from '../modules/chess/chessGame.js';
import { isValidUci } from '../modules/chess/uci.js';
import { appendMove } from '../modules/games/games.repository.js';
import { Clock } from '../modules/clocks/clock.js';
import { finishGame } from '../modules/games/finishGame.js';

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
  onFinished?: () => void;
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
  turnTimer?: NodeJS.Timeout;
  abortTimer?: NodeJS.Timeout;
  onFinished?: () => void;

  private io: Server;
  clock: Clock;
  private turnStartedAt: number;
  private abortDeadline?: number;
  private lastTask: Promise<unknown> = Promise.resolve();

  constructor(data: GameSessionData) {
    this.gameId = data.gameId;
    this.whiteId = data.whiteId;
    this.blackId = data.blackId;
    this.category = data.category;
    this.timeControl = data.timeControl;
    this.game = data.game;
    this.io = data.io;
    this.onFinished = data.onFinished;

    if (data.gameInstance) {
      this.gameInstance = data.gameInstance;
    } else if (data.initialMoves && data.initialMoves.length > 0) {
      this.gameInstance = ChessGame.fromMoves(data.initialMoves);
    } else {
      this.gameInstance = new ChessGame();
    }

    this.turnStartedAt = performance.now();

    const isFirstMove = this.gameInstance.history.length === 0;

    this.clock = new Clock(
      this.timeControl.baseSeconds,
      this.timeControl.incrementSeconds,
      isFirstMove ? 'b' : this.gameInstance.turn,
    );

    if (this.game.status === 'ACTIVE') {
      if (isFirstMove) {
        this.startAbortTimer();
      } else {
        this.clock.start(this.turnStartedAt);
        this.resetTurnTimer();
      }
    }
  }

  async mutex<T>(task: () => Promise<T>): Promise<T> {
    const currentTask = this.lastTask.then(task, task);
    this.lastTask = currentTask.catch(() => {});
    return currentTask;
  }

  private clearTimers(): void {
    clearTimeout(this.abortTimer);
    this.abortTimer = undefined;
    this.abortDeadline = undefined;

    clearTimeout(this.turnTimer);
    this.turnTimer = undefined;

    clearTimeout(this.disconnectedTimer);
    this.disconnectedTimer = undefined;
  }

  private startAbortTimer(): void {
    clearTimeout(this.abortTimer);

    this.abortDeadline = performance.now() + 30_000;
    this.abortTimer = setTimeout(() => {
      void this.handleAbortBeforeFirstMove();
    }, 30_000);
  }

  emitClockSnapshot(): void {
    const snapshot = this.clock.getSnapshot(performance.now());
    this.io.to(`game:${this.gameId}`).emit('clock:update', snapshot);
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

  private async abortBeforeFirstMoveLocked(): Promise<void> {
    if (this.game.status !== 'ACTIVE' || this.gameInstance.history.length > 0) {
      return;
    }

    const finishedGame = await finishGame(this.gameId, {
      status: 'ABANDONED',
      result: 'DRAW',
      reason: 'ABANDONED',
      finalFen: this.gameInstance.fen,
      pgn: '',
    });

    this.game = finishedGame.game;
    this.clearTimers();
    if (finishedGame.finishedNow) {
      this.io.to(`game:${this.gameId}`).emit('game:over', {
        result: null,
        reason: 'ABANDONED',
      });
    }

    this.onFinished?.();
  }

  private async handleAbortBeforeFirstMove(): Promise<void> {
    return this.mutex(async () => {
      await this.abortBeforeFirstMoveLocked();
    });
  }

  private async finishOnTimeout(): Promise<void> {
    if (this.game.status !== 'ACTIVE') return;

    const timedOutColor = this.gameInstance.turn;
    const opponentColor = timedOutColor === 'w' ? 'b' : 'w';

    const result: GameResult = this.gameInstance.isInsufficientMaterial()
      ? 'DRAW'
      : opponentColor === 'w'
        ? 'WHITE_WIN'
        : 'BLACK_WIN';

    const reason: ResultReason = result === 'DRAW' ? 'INSUFFICIENT_MATERIAL' : 'TIMEOUT';

    const finishedGame = await finishGame(this.gameId, {
      status: 'FINISHED',
      result,
      reason,
      finalFen: this.gameInstance.fen,
      pgn: '',
    });

    this.game = finishedGame.game;
    this.clearTimers();

    if (finishedGame.finishedNow) {
      this.io.to(`game:${this.gameId}`).emit('game:over', {
        result,
        reason,
      });
    }

    this.onFinished?.();
  }

  async handleTimeout(): Promise<void> {
    return this.mutex(async () => {
      if (this.game.status !== 'ACTIVE') return;

      const now = performance.now();
      const sideToMove = this.gameInstance.turn;
      const remainingTime = this.clock.getRemainingTime(sideToMove, now);

      if (remainingTime > 0) {
        this.resetTurnTimer();
        return;
      }

      await this.finishOnTimeout();
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

      const isFirstMove = this.gameInstance.history.length === 0;
      const now = performance.now();

      if (isFirstMove && this.abortDeadline !== undefined && now >= this.abortDeadline) {
        await this.abortBeforeFirstMoveLocked();

        throw new AppError(ErrorCode.CONFLICT, 409, 'First move deadline expired');
      }

      if (!isFirstMove) {
        const remainingBeforeMove = this.clock.getRemainingTime(sideToMove, now);

        if (remainingBeforeMove <= 0) {
          await this.finishOnTimeout();

          throw new AppError(ErrorCode.CONFLICT, 409, 'Your clock has expired');
        }
      }

      const timeSpentMs = isFirstMove ? 0 : Math.round(now - this.turnStartedAt);

      const moveData = this.gameInstance.applyMove(uci);

      if (!isFirstMove) {
        const timedOut = this.clock.completeMove(now);

        if (timedOut) {
          await this.finishOnTimeout();

          throw new AppError(ErrorCode.CONFLICT, 409, 'Your clock has expired');
        }
      }

      const ply = this.gameInstance.history.length;
      const clockAfterMs = Math.round(this.clock.getStoredRemainingTime(sideToMove));

      await appendMove(
        this.gameId,
        {
          ply,
          san: moveData.san,
          uci,
          fenAfter: moveData.fen,
          timeSpentMs,
          clockAfterMs,
          game: { connect: { id: this.gameId } },
        },
        {},
      );

      this.drawOffer.offeredBy = null;
      const outcome = this.gameInstance.getOutcome();

      if (outcome?.result) {
        const finishedGame = await finishGame(this.gameId, {
          status: 'FINISHED',
          result: outcome.result,
          reason: outcome.reason,
          finalFen: moveData.fen,
          pgn: '',
        });

        this.game = finishedGame.game;
        this.clearTimers();

        if (finishedGame.finishedNow) {
          this.io.to(`game:${this.gameId}`).emit('game:over', {
            result: outcome.result,
            reason: outcome.reason,
          });
        }
        this.onFinished?.();
      } else if (isFirstMove) {
        this.clearTimers();

        this.turnStartedAt = performance.now();
        this.clock.start(this.turnStartedAt);
        this.resetTurnTimer();
        this.emitClockSnapshot();
      } else {
        this.turnStartedAt = now;
        this.resetTurnTimer();
        this.emitClockSnapshot();
      }

      return { ply, ...moveData, uci, outcome, clocks: this.clock.getClockSnapshot() };
    });
  }

  async resign(userId: string) {
    return this.mutex(async () => {
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
        throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
      }

      if (this.game.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Game is not active');
      }

      const finishedGame = await finishGame(this.gameId, {
        status: 'FINISHED',
        result: outcome.result,
        reason: outcome.reason,
        finalFen: this.gameInstance.fen,
        pgn: '',
      });

      this.game = finishedGame.game;
      this.clearTimers();

      if (finishedGame.finishedNow) {
        this.io.to(`game:${this.gameId}`).emit('game:over', outcome);
      }

      this.onFinished?.();
      return outcome;
    });
  }

  async handleDrawOffer(userId: string) {
    if (userId !== this.blackId && userId !== this.whiteId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
    }

    this.drawOffer.offeredBy = userId;
  }

  async handleDrawAccept(userId: string) {
    return this.mutex(async () => {
      if (this.drawOffer.offeredBy === null || this.drawOffer.offeredBy === userId) {
        throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
      }

      if (userId !== this.whiteId && userId !== this.blackId) {
        throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
      }

      if (this.game.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Game is not active');
      }

      const outcome = await finishGame(this.gameId, {
        status: 'FINISHED',
        result: 'DRAW',
        reason: 'DRAW_AGREEMENT',
        finalFen: this.gameInstance.fen,
        pgn: '',
      });

      this.game = outcome.game;
      this.clearTimers();

      if (outcome.finishedNow) {
        this.io.to(`game:${this.gameId}`).emit('game:over', {
          result: 'DRAW',
          reason: 'DRAW_AGREEMENT',
        });
      }

      this.onFinished?.();
      return outcome;
    });
  }

  async handleDrawDecline(userId: string) {
    if (this.drawOffer.offeredBy === null || this.drawOffer.offeredBy === userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
    }

    if (userId !== this.whiteId && userId !== this.blackId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don’t have access to do this');
    }

    this.drawOffer.offeredBy = null;
  }

  async handleDisconnect(socketId: string, io: Server) {
    const isWhite = socketId === this.whiteSocketId;
    const isBlack = socketId === this.blackSocketId;

    if (!isWhite && !isBlack) return;

    clearTimeout(this.disconnectedTimer);

    io.to(`game:${this.gameId}`).emit('game:opponent:disconnected', {
      graceSeconds: 30,
    });

    this.disconnectedTimer = setTimeout(() => {
      void this.mutex(async () => {
        if (this.game.status !== 'ACTIVE') return;

        const result: GameResult = isWhite ? 'BLACK_WIN' : 'WHITE_WIN';

        const finishedGame = await finishGame(this.gameId, {
          status: 'FINISHED',
          result,
          reason: 'ABANDONED',
          finalFen: this.gameInstance.fen,
          pgn: '',
        });

        this.game = finishedGame.game;
        this.clearTimers();

        if (finishedGame.finishedNow) {
          io.to(`game:${this.gameId}`).emit('game:over', {
            result,
            reason: 'ABANDONED',
          });
        }
        this.onFinished?.();
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

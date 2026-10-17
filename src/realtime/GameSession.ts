import { Game, GameResult, ResultReason } from '@prisma/client';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import { ChessGame } from '../modules/chess/chessGame.js';
import { isValidUci } from '../modules/chess/uci.js';
import { appendMove, finish } from '../modules/games/games.repository.js';

export interface GameSessionData {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: unknown;
  game: Game;
  gameInstance?: ChessGame;
  initialMoves?: string[];
}

export class GameSession {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: unknown;
  game: Game;
  gameInstance: ChessGame;

  whiteSocketId?: string;
  blackSocketId?: string;
  spectators: Set<string> = new Set();

  drawOffer: { offeredBy: string | null } = { offeredBy: null };
  disconnectedTimer?: NodeJS.Timeout;

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
  }

  async mutex<T>(task: () => Promise<T>): Promise<T> {
    const currentTask = this.lastTask.then(task, task);
    this.lastTask = currentTask.catch(() => {});
    return currentTask;
  }

  async handleMove(userId: string, uci: string) {
    return this.mutex(async () => {
      if (this.game.status !== 'ACTIVE') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Game is not active');
      }

      this.drawOffer.offeredBy = null;
      const currentPlayerId = this.gameInstance.turn === 'w' ? this.whiteId : this.blackId;

      if (currentPlayerId !== userId) {
        throw new AppError(ErrorCode.NOT_YOUR_TURN, 400, 'It is not your turn');
      }

      if (!isValidUci(uci)) {
        throw new AppError(ErrorCode.ILLEGAL_MOVE, 400, 'Invalid UCI formatting');
      }

      const moveData = this.gameInstance.applyMove(uci);
      const ply = this.gameInstance.history.length;

      const move = await appendMove(
        this.gameId,
        {
          ply,
          san: moveData.san,
          uci,
          fenAfter: moveData.fen,
          timeSpentMs: 0,
          clockAfterMs: 0,
          game: { connect: { id: this.gameId } },
        },
        {},
      );

      void move;

      const outcome = this.gameInstance.getOutcome();
      if (outcome?.result) {
        this.game.status = 'FINISHED';
        await finish(this.gameId, {
          status: this.game.status,
          result: outcome.result,
          reason: outcome.reason,
          finalFen: moveData.fen,
          pgn: '',
        });
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
      finalFen: '',
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
      finalFen: '',
      pgn: '',
    });
  }

  async handleDrawDecline(userId: string) {
    if (this.drawOffer.offeredBy === null || this.drawOffer.offeredBy === userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 401, 'You don`t have access to do this');
    }

    this.drawOffer.offeredBy = null;
  }
}

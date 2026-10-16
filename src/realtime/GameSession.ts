import { Game } from '@prisma/client';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/codes.js';
import { ChessGame } from '../modules/chess/chessGame.js';
import { isValidUci } from '../modules/chess/uci.js';
import { appendMove } from '../modules/games/games.repository.js';

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
        //store to DB
      }

      return { ply, ...moveData, uci, outcome };
    });
  }
}

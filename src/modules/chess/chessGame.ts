import { ResultReason, GameResult } from '@prisma/client';
import { Chess } from 'chess.js';
import { isValidUci, parseUci } from './uci.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { Color, OutCome } from './types.js';

export class ChessGame {
  private readonly chess: Chess;

  constructor(fen?: string) {
    this.chess = new Chess(fen);
  }

  static fromFen(fen: string): ChessGame {
    return new ChessGame(fen);
  }

  static fromMoves(moves: string[]): ChessGame {
    const game = new ChessGame();
    for (const uci of moves) {
      game.applyMove(uci);
    }
    return game;
  }

  applyMove(uci: string): { san: string; fen: string } {
    if (!isValidUci(uci)) {
      throw new AppError(ErrorCode.ILLEGAL_MOVE, 400, 'Illegal Move ' + uci);
    }
    const { from, to, promotion } = parseUci(uci);

    const move = this.chess.move({ from, to, promotion });
    if (!move) {
      throw new AppError(ErrorCode.ILLEGAL_MOVE, 400, 'Illegal Move ' + uci);
    }

    return { san: move.san, fen: this.chess.fen() };
  }

  getLegalMoves(): string[] {
    return this.chess.moves({ verbose: true }).map(
      ({ from, to, promotion }) => `${from}${to}${promotion ?? ''}`,
    );
  }

  getOutcome(): OutCome | null {
    if (!this.chess.isGameOver()) return null;

    if (this.chess.isCheckmate()) {
      if (this.chess.turn() === 'b') {
        return {
          result: GameResult.WHITE_WIN,
          reason: ResultReason.CHECKMATE,
        };
      } else {
        return { result: GameResult.BLACK_WIN, reason: ResultReason.CHECKMATE };
      }
    }

    if (this.chess.isStalemate()) {
      return { result: GameResult.DRAW, reason: ResultReason.STALEMATE };
    }

    if (this.chess.isInsufficientMaterial()) {
      return { result: GameResult.DRAW, reason: ResultReason.INSUFFICIENT_MATERIAL };
    }

    if (this.chess.isThreefoldRepetition()) {
      return { result: GameResult.DRAW, reason: ResultReason.THREEFOLD };
    }

    if (this.chess.isDrawByFiftyMoves()) {
      return { result: GameResult.DRAW, reason: ResultReason.FIFTY_MOVE };
    }

    if (parseInt(this.chess.fen().split(' ')[4] ?? '0', 10) >= 100) {
      return { result: GameResult.DRAW, reason: ResultReason.FIFTY_MOVE };
    }

    return null;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn() as Color;
  }

  get plyCount(): number {
    return this.chess.history().length;
  }

  get isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  get history(): string[] {
    return this.chess.history();
  }

  get verboseHistory() {
    return this.chess.history({ verbose: true });
  }
}

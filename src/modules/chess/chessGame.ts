import { Chess } from 'chess.js';
import { isValidUci, parseUci } from './uci.js';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { Color } from './types.js';

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
}

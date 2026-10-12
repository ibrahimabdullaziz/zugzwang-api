import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { UCIFormat } from './types.js';
import { Chess } from 'chess.js';

export function isValidUci(move: string): boolean {
  const uciRegex = /^[a-h][1-8][a-h][1-8][qbrn]?$/;

  return uciRegex.test(move);
}

export function parseUci(uci: string): UCIFormat {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length === 5 ? uci[4] : undefined,
  };
}

export function parseUciToSan(chess: Chess, uciMove: string): string {
  const { from, to, promotion } = parseUci(uciMove);

  const legalMoves = chess.moves({ verbose: true });

  const match = legalMoves.find((m) => m.from === from && m.to === to && m.promotion === promotion);

  if (!match) {
    throw new AppError(ErrorCode.ILLEGAL_MOVE, 400, 'Illegal Move');
  }

  return match.san;
}

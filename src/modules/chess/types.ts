import { GameResult, GameStatus, ResultReason } from '@prisma/client';

export type Color = 'w' | 'b';
export type UCI = string;
export interface UCIFormat {
  from: string;
  to: string;
  promotion?: string;
}
export interface OutCome {
  result: GameResult;
  reason: ResultReason;
}
export interface TimeControl {
  baseSeconds: number;
  incrementSecs: number;
}

export interface PgnParams {
  white: string;
  black: string;
  date: Date;
  result: GameResult | null;
  reason: ResultReason | null;
  timeControl: TimeControl;
  moves: string[];
}

export interface FinishGameData {
  status: typeof GameStatus.FINISHED | typeof GameStatus.ABANDONED;
  result: GameResult;
  reason: ResultReason;
  finalFen: string;
  pgn: string;
}

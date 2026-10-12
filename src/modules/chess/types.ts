import { GameResult, ResultReason } from '@prisma/client';

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
  white: string; // username or 'Anonymous'
  black: string;
  date: Date;
  result: GameResult | null; // null if game is still ongoing
  reason: ResultReason | null;
  timeControl: TimeControl; // { baseSeconds, incrementSecs }
  moves: string[]; // array of SAN moves in order e.g. ['e4', 'e5', 'Nf3']
}

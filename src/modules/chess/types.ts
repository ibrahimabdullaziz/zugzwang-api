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

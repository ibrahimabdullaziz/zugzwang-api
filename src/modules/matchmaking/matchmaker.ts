import { RatingCategory } from '@prisma/client';
import { TimeControl } from '../chess/types.js';

export interface QueueEntry {
  userId: string;
  socketId: string;
  rating: number;
  timeControl: TimeControl;
  category: RatingCategory;
  joinedAt: number;
}

export interface Pair {
  player1: QueueEntry;
  player2: QueueEntry;
}

export interface MatchMaker {
  enqueue: (entry: QueueEntry) => Promise<void>;
  dequeue: (userId: string) => Promise<boolean>;
  tick: () => Promise<Pair[]>;
  isQueued: (userId: string) => Promise<boolean>;
  size: (category?: RatingCategory) => Promise<number>;
}

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
  enqueue: (entry: QueueEntry) => void;
  dequeue: (userId: string) => boolean;
  trick: () => Pair[];
  isQueued: (userId: string) => boolean;
  size: (category?: RatingCategory) => number;
}

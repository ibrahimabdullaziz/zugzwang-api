import { RatingCategory } from '@prisma/client';
import { Pair, QueueEntry } from './matchmaker.js';

const queues = new Map<RatingCategory, QueueEntry[]>();
const userToCategoryMap = new Map<string, RatingCategory>();

queues.set('BULLET', []);
queues.set('BLITZ', []);
queues.set('RAPID', []);
export function tick(): Pair[] {
  const allMatchedPairs: Pair[] = [];
  const now = Date.now();

  for (const [category, queue] of queues.entries()) {
    if (queue.length < 2) continue;

    const matchedUserIds = new Set<string>();
    const categoryPairs: Pair[] = [];

    for (let i = 0; i < queue.length; i++) {
      const p1 = queue[i];
      if (!p1 || matchedUserIds.has(p1.userId)) continue;

      for (let j = i + 1; j < queue.length; j++) {
        const p2 = queue[j];
        if (!p2 || matchedUserIds.has(p2.userId)) continue;

        const isSameTimeControl =
          p1.timeControl.baseSeconds === p2.timeControl.baseSeconds &&
          p1.timeControl.incrementSecs === p2.timeControl.incrementSecs;

        if (p1.userId !== p2.userId && isSameTimeControl) {
          const waitTime1 = now - p1.joinedAt;
          const waitTime2 = now - p2.joinedAt;

          const allowedDiff1 = 100 + Math.floor(waitTime1 / 5000) * 50;
          const allowedDiff2 = 100 + Math.floor(waitTime2 / 5000) * 50;

          const ratingDiff = Math.abs(p1.rating - p2.rating);
          const maxAllowed = Math.min(allowedDiff1, allowedDiff2);

          if (ratingDiff <= maxAllowed) {
            categoryPairs.push({ player1: p1, player2: p2 });

            matchedUserIds.add(p1.userId);
            matchedUserIds.add(p2.userId);

            userToCategoryMap.delete(p1.userId);
            userToCategoryMap.delete(p2.userId);

            break;
          }
        }
      }
    }

    if (matchedUserIds.size > 0) {
      const updatedQueue = queue.filter((p) => !matchedUserIds.has(p.userId));
      queues.set(category, updatedQueue);
    }

    allMatchedPairs.push(...categoryPairs);
  }

  return allMatchedPairs;
}

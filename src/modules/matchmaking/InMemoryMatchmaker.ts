import { RatingCategory } from '@prisma/client';
import type { MatchMaker, Pair, QueueEntry } from './matchmaker.js';

export class InMemoryMatchmaker implements MatchMaker {
  private readonly queues = new Map<RatingCategory, QueueEntry[]>([
    ['BULLET', []],
    ['BLITZ', []],
    ['RAPID', []],
  ]);

  private readonly userToCategoryMap = new Map<string, RatingCategory>();

  enqueue(entry: QueueEntry): void {
    const queue = this.queues.get(entry.category) ?? [];
    queue.push(entry);
    this.queues.set(entry.category, queue);
    this.userToCategoryMap.set(entry.userId, entry.category);
  }

  dequeue(userId: string): boolean {
    const category = this.userToCategoryMap.get(userId);
    if (!category) return false;

    const queue = this.queues.get(category);
    if (queue) {
      this.queues.set(
        category,
        queue.filter((entry) => entry.userId !== userId),
      );
    }
    this.userToCategoryMap.delete(userId);
    return true;
  }

  tick(): Pair[] {
    const allMatchedPairs: Pair[] = [];
    const now = Date.now();

    for (const [category, queue] of this.queues.entries()) {
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

              this.userToCategoryMap.delete(p1.userId);
              this.userToCategoryMap.delete(p2.userId);

              break;
            }
          }
        }
      }

      if (matchedUserIds.size > 0) {
        this.queues.set(
          category,
          queue.filter((entry) => !matchedUserIds.has(entry.userId)),
        );
      }

      allMatchedPairs.push(...categoryPairs);
    }

    return allMatchedPairs;
  }

  isQueued(userId: string): boolean {
    return this.userToCategoryMap.has(userId);
  }

  size(category?: RatingCategory): number {
    if (category) return this.queues.get(category)?.length ?? 0;
    return [...this.queues.values()].reduce((total, queue) => total + queue.length, 0);
  }
}

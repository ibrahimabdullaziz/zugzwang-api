import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';

export class Clock {
  private whiteRemainingMs: number;
  private blackRemainingMs: number;
  private incrementMs: number;
  private lastMoveTimestamp: number | null = null;
  private activeColor: 'w' | 'b';

  constructor(baseSeconds: number, incrementSeconds: number, activeColor: 'w' | 'b' = 'w') {
    this.whiteRemainingMs = baseSeconds * 1000;
    this.blackRemainingMs = baseSeconds * 1000;
    this.incrementMs = incrementSeconds * 1000;
    this.activeColor = activeColor;
  }

  start(now: number): void {
    if (this.lastMoveTimestamp !== null) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Clock has already started');
    }

    this.lastMoveTimestamp = now;
  }

  getRemainingTime(color: 'w' | 'b', now: number): number {
    const remaining = color === 'w' ? this.whiteRemainingMs : this.blackRemainingMs;

    if (color !== this.activeColor || this.lastMoveTimestamp === null) {
      return remaining;
    }

    return Math.max(0, remaining - (now - this.lastMoveTimestamp));
  }

  getStoredRemainingTime(color: 'w' | 'b'): number {
    return color === 'w' ? this.whiteRemainingMs : this.blackRemainingMs;
  }

  completeMove(now: number): boolean {
    if (this.lastMoveTimestamp === null) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Clock has not started');
    }

    const elapsedMs = Math.max(0, now - this.lastMoveTimestamp);

    if (this.activeColor === 'w') {
      this.whiteRemainingMs -= elapsedMs;

      if (this.whiteRemainingMs <= 0) {
        this.whiteRemainingMs = 0;
        return true;
      }

      this.whiteRemainingMs += this.incrementMs;
      this.activeColor = 'b';
    } else {
      this.blackRemainingMs -= elapsedMs;

      if (this.blackRemainingMs <= 0) {
        this.blackRemainingMs = 0;
        return true;
      }

      this.blackRemainingMs += this.incrementMs;
      this.activeColor = 'w';
    }

    this.lastMoveTimestamp = now;
    return false;
  }

  getSnapshot(now = performance.now()): {
    whiteMs: number;
    blackMs: number;
    activeColor: 'w' | 'b';
    serverTimestamp: number;
  } {
    return {
      whiteMs: this.getRemainingTime('w', now),
      blackMs: this.getRemainingTime('b', now),
      activeColor: this.activeColor,
      serverTimestamp: Date.now(),
    };
  }

}

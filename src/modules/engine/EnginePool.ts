import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';
import { config } from '../../config/env.js';
import type { EngineEvaluation, EngineOptions } from './IEngine.js';
import { UciEngine } from './UciEngine.js';
export class EnginePool {
  private engines: UciEngine[] = [];
  private idle: UciEngine[] = [];
  private queue: Array<{ resolve: (engine: UciEngine) => void; reject: (error: Error) => void }> =
    [];
  private closed = false;

  private readonly MAX_QUEUE_SIZE = 20;

  async initialize(): Promise<void> {
    for (let i = 0; i < config.engine.poolSize; i++) {
      const engine: UciEngine = new UciEngine(config.engine.binaryPath);

      const ready = await engine.isReady();

      if (!ready) {
        await engine.destroy();
        throw new Error('Failed to initialize engine');
      }

      this.engines.push(engine);
      this.idle.push(engine);
    }
  }

  async acquire(): Promise<UciEngine> {
    if (this.closed) {
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 503, 'Engine pool is closed');
    }
    if (this.idle.length > 0) {
      return this.idle.pop()!;
    }

    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 503, 'Engine pool is saturated');
    }

    return new Promise<UciEngine>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  release(engine: UciEngine): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve(engine);
    } else {
      this.idle.push(engine);
    }
  }

  async evaluate(fen: string, options?: EngineOptions): Promise<EngineEvaluation> {
    const engine = await this.acquire();

    try {
      return await engine.evaluate(fen, options);
    } finally {
      this.release(engine);
    }
  }

  async destroy(): Promise<void> {
    this.closed = true;

    for (const waiter of this.queue) {
      waiter.reject(new Error('Engine pool is shutting down'));
    }

    this.queue = [];

    await Promise.all(this.engines.map((e) => e.destroy()));

    this.engines = [];
    this.idle = [];
  }
}

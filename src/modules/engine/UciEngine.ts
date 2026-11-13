import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EngineEvaluation, EngineOptions, IEngine } from './IEngine.js';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/codes.js';

export class UciEngine implements IEngine {
  private process!: ChildProcessWithoutNullStreams;
  private output!: Interface;
  private ready = false;
  private readyWaiter: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private resolveTask: ((value: EngineEvaluation) => void) | null = null;
  private rejectTask: ((reason: Error) => void) | null = null;
  private currentEvaluation: Omit<EngineEvaluation, 'bestMoveUci'> = {
    depth: 0,
  };
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private enginePath: string) {
    this.readyPromise = new Promise((resolve) => (this.resolveReady = resolve));
    this.process = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.output = createInterface({ input: this.process.stdout });

    this.output.on('line', (line) => {
      if (line === 'uciok') {
        this.process.stdin.write('isready\n');
      } else if (line === 'readyok') {
        this.ready = true;
        this.resolveReady();
        this.readyWaiter?.();
        this.readyWaiter = null;
      } else if (line.startsWith('info ')) {
        const tokens = line.split(/\s+/);

        const depthIndex = tokens.indexOf('depth');
        if (depthIndex !== -1) {
          this.currentEvaluation.depth = Number(tokens[depthIndex + 1]);
        }
        const scoreIndex = tokens.indexOf('score');
        if (scoreIndex !== -1) {
          const type = tokens[scoreIndex + 1];
          const value = Number(tokens[scoreIndex + 2]);

          if (type === 'cp') {
            this.currentEvaluation.scoreCp = value;
            delete this.currentEvaluation.mate;
          } else if (type === 'mate') {
            this.currentEvaluation.mate = value;
            delete this.currentEvaluation.scoreCp;
          }
        }
        const pvIndex = tokens.indexOf('pv');
        if (pvIndex !== -1) {
          this.currentEvaluation.pv = tokens.slice(pvIndex + 1);
        }
      } else if (line.startsWith('bestmove ')) {
        const bestMoveUci = line.split(/\s+/)[1];
        const resolve = this.resolveTask;

        if (!bestMoveUci || !resolve) return;

        const result: EngineEvaluation = { ...this.currentEvaluation, bestMoveUci };

        this.resolveTask = null;
        this.rejectTask = null;

        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }

        resolve(result);
      }
    });

    this.process.on('error', (error) => this.fail(error));

    this.process.on('exit', (_code, signal) => {
      this.fail(new Error(`Engine exited: ${signal ?? 'unknown'}`));
    });

    this.process.stdin.write('uci\n');
  }

  async isReady(): Promise<boolean> {
    await this.readyPromise;
    return this.ready;
  }

  private waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.readyWaiter = null;
        reject(new Error('Engine readiness timed out'));
      }, 3000);

      this.readyWaiter = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.process.stdin.write('isready\n');
    });
  }

  async evaluate(fen: string, options?: EngineOptions): Promise<EngineEvaluation> {
    if (!this.ready) {
      throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Engine is not ready');
    }

    if (this.resolveTask !== null) {
      throw new AppError(ErrorCode.GAME_NOT_FOUND, 404, 'Engine is busy');
    }

    if (options?.skillLevel !== undefined) {
      this.skillLevel(options.skillLevel);
      await this.waitUntilReady();
    }

    if (options?.useEloLimit !== undefined) {
      this.process.stdin.write(`setoption name UCI_limitStrength value ${options.useEloLimit}\n`);
    }

    if (options?.useEloLimit && options?.targetElo !== undefined) {
      this.process.stdin.write(`setoption name UCI_Elo value ${options.targetElo}\n`);
    }

    if (options?.skillLevel !== undefined && options.useEloLimit !== undefined) {
      await this.waitUntilReady();
    }

    this.currentEvaluation = { depth: 0 };

    const gamePromise = new Promise<EngineEvaluation>((resolve, reject) => {
      this.resolveTask = resolve;
      this.rejectTask = reject;
    });

    this.process.stdin.write(`position fen ${fen}\n`);

    if (options?.depth) {
      this.process.stdin.write(`go depth ${options.depth}\n`);
    } else if (options?.moveTime) {
      this.process.stdin.write(`go movetime ${options.moveTime}\n`);
    } else {
      this.process.stdin.write(`go movetime ${1000}\n`);
    }

    const timeoutMs = options?.moveTime ? +options?.moveTime + 2000 : 3000;

    this.timeout = setTimeout(() => {
      this.process.stdin.write('stop\n');
      this.fail(new Error('Engine evaluation timed out'));
    }, timeoutMs);

    return gamePromise;
  }

  async stop() {
    if (this.resolveTask === null) return;

    this.process.stdin.write('stop\n');
  }

  async destroy() {
    this.fail(new Error('Engine destroyed'));
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill();
    }

    this.output.close();
  }

  private fail(error: Error) {
    this.ready = false;
    this.resolveReady();

    const reject = this.rejectTask;
    this.resolveTask = null;
    this.rejectTask = null;

    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    reject?.(error);
  }

  async newGame() {
    if (!this.ready) throw new Error('Engine is not ready');

    this.process.stdin.write('ucinewgame\n');
    this.ready = false;
    await this.waitUntilReady();
  }

  skillLevel(level: number) {
    if (!Number.isInteger(level) || level < 0 || level > 20) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Skill level must be between 0 and 20');
    }
    this.process.stdin.write(`setoption name Skill Level value ${level}\n`);
  }

  async setEloLimit(enabled: boolean, elo?: number): Promise<void> {
    if (enabled && (elo === undefined || elo < 1320 || elo > 3190)) {
      throw new Error('Elo must be between 1320 and 3190');
    }

    this.process.stdin.write(`setoption name UCI_LimitStrength value ${enabled}\n`);

    if (enabled) {
      this.process.stdin.write(`setoption name UCI_Elo value ${elo}\n`);
    }

    await this.waitUntilReady();
  }
}

export interface EngineEvaluation {
  bestMoveUci: string;
  scoreCp?: number;
  mate?: number;
  depth: number;
  pv?: string[];
}

export interface EngineOptions {
  depth?: number;
  moveTime?: number;
  skillLevel?: number;
  targetElo?: number;
  useEloLimit?: boolean;
}

export interface IEngine {
  isReady(): Promise<boolean>;
  evaluate(fen: string, options?: EngineOptions): Promise<EngineEvaluation>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

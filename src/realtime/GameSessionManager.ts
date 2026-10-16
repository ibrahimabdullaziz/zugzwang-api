import { findById } from '../modules/games/games.repository.js';
import { GameSession } from './GameSession.js';

export class GameSessionManager {
  private static instance: GameSessionManager;
  private sessions: Map<string, GameSession> = new Map();

  public static getInstance(): GameSessionManager {
    if (!GameSessionManager.instance) {
      GameSessionManager.instance = new GameSessionManager();
    }
    return GameSessionManager.instance;
  }

  public async getOrLoad(gameId: string): Promise<GameSession | null> {
    if (this.sessions.has(gameId)) {
      return this.sessions.get(gameId) ?? null;
    }

    const game = await findById(gameId, true);

    if (!game || game.status === 'FINISHED' || game.status === 'ABANDONED') return null;

    const rawMoves = (game as { moves?: { uci: string }[] }).moves ?? [];
    const initialMoves = rawMoves.map((m) => m.uci);

    const session = new GameSession({
      gameId: game.id,
      whiteId: game.whiteId!,
      blackId: game.blackId!,
      category: game.category,
      timeControl: {
        baseSeconds: game.baseSeconds,
        incrementSecs: game.incrementSecs,
      },
      game,
      initialMoves,
    });
    this.sessions.set(gameId, session);
    return session;
  }

  public removeSession(gameId: string): void {
    this.sessions.delete(gameId);
  }

  public getSession(gameId: string): GameSession | undefined {
    return this.sessions.get(gameId);
  }
}

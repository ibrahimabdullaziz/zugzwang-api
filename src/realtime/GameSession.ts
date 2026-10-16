import { Game } from '@prisma/client';

interface GameSessionData {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: unknown;
  game: Game;
}

export class GameSession {
  gameId: string;
  whiteId: string;
  blackId: string;
  category: string;
  timeControl: unknown;
  game: Game;

  whiteSocketId?: string;
  blackSocketId?: string;
  spectators: Set<string> = new Set();

  drawOffer: { offeredBy: string | null } = { offeredBy: null };
  disconnectedTimer?: NodeJS.Timeout;

  constructor(data: GameSessionData) {
    this.gameId = data.gameId;
    this.whiteId = data.whiteId;
    this.blackId = data.blackId;
    this.category = data.category;
    this.timeControl = data.timeControl;
    this.game = data.game;
  }
}

import { z } from 'zod';

const gameIdSchema = z.string().uuid({ message: 'Invalid game ID format' });

const uciMoveSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, {
  message: 'Invalid UCI move format',
});

export const gameJoinSchema = z.object({
  gameId: gameIdSchema,
});

export const gameMoveSchema = z.object({
  gameId: gameIdSchema,
  uci: uciMoveSchema,
});

export const gameActionSchema = z.object({
  gameId: gameIdSchema,
});

export type GameJoinPayload = z.infer<typeof gameJoinSchema>;
export type GameMovePayload = z.infer<typeof gameMoveSchema>;
export type GameActionPayload = z.infer<typeof gameActionSchema>;

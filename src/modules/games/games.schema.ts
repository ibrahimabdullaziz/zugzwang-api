import { z } from 'zod';

export const INVITE_CODE_LENGTH = 10;

export const createGameBodySchema = z.object({
  timeControl: z.object({
    baseSeconds: z.number().int().min(10).max(3600),
    incrementSecs: z.number().int().min(0).max(60),
  }),
  color: z.enum(['white', 'black', 'random']).optional(),
  rated: z.boolean().default(true),
});

export const joinGameParamsSchema = z.object({
  code: z.string().length(INVITE_CODE_LENGTH),
});

export const gameIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listGamesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreateGameBodyInput = z.infer<typeof createGameBodySchema>;
export type JoinGameParamsInput = z.infer<typeof joinGameParamsSchema>;
export type GameIdParamsInput = z.infer<typeof gameIdParamsSchema>;
export type ListGamesQueryInput = z.infer<typeof listGamesQuerySchema>;

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard.js';
import { validate } from '../../common/middleware/validate.js';
import { successResponse } from '../../common/utils/apiResponse.js';
import { listByUser } from './games.repository.js';
import {
  createGameBodySchema,
  gameIdParamsSchema,
  joinGameParamsSchema,
  listGamesQuerySchema,
  type CreateGameBodyInput,
  type GameIdParamsInput,
  type JoinGameParamsInput,
  type ListGamesQueryInput,
} from './games.schema.js';
import * as gamesService from './games.service.js';

export const gamesRouter = Router();

const resolvePlayerColor = (color?: 'white' | 'black' | 'random') => {
  if (color === 'white') return 'w';
  if (color === 'black') return 'b';
  if (color === 'random') return Math.random() < 0.5 ? 'w' : 'b';
  return undefined;
};

gamesRouter.post('/', authGuard, validate(createGameBodySchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as CreateGameBodyInput;
    const game = await gamesService.createChallenge(
      req.user!.id,
      body.timeControl,
      resolvePlayerColor(body.color),
      body.rated,
    );

    res.status(201).json(successResponse(game));
  } catch (error) {
    next(error);
  }
});

gamesRouter.post(
  '/join/:code',
  authGuard,
  validate(joinGameParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const params = req.params as JoinGameParamsInput;
      const game = await gamesService.joinByCode(req.user!.id, params.code);
      res.status(200).json(successResponse(game));
    } catch (error) {
      next(error);
    }
  },
);

gamesRouter.get(
  '/me',
  authGuard,
  validate(listGamesQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as ListGamesQueryInput;
      const result = await listByUser(req.user!.id, {
        cursor: query.cursor,
        limit: query.limit,
      });

      res.status(200).json(successResponse(result));
    } catch (error) {
      next(error);
    }
  },
);

gamesRouter.get('/:id/moves', validate(gameIdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const params = req.params as GameIdParamsInput;
    const moves = await gamesService.getGameMoves(params.id);
    res.status(200).json(successResponse(moves));
  } catch (error) {
    next(error);
  }
});

gamesRouter.get('/:id/reply', validate(gameIdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const params = req.params as GameIdParamsInput;
    const game = await gamesService.getGameReplay(params.id);
    res.status(200).json(successResponse(game));
  } catch (error) {
    next(error);
  }
});

gamesRouter.get(':id/pgn', validate(gameIdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const params = req.params as GameIdParamsInput;
    const pgn = await gamesService.getGamePgn(params.id);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="game-${params.id}.pgn"`);
    res.send(pgn);
  } catch (error) {
    next(error);
  }
});

gamesRouter.get('/:id', validate(gameIdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const params = req.params as GameIdParamsInput;
    const game = await gamesService.getGame(params.id);
    res.status(200).json(successResponse(game));
  } catch (error) {
    next(error);
  }
});

gamesRouter.post(
  '/:id/resign',
  authGuard,
  validate(gameIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const params = req.params as GameIdParamsInput;
      const game = await gamesService.resign(req.user!.id, params.id);
      res.status(200).json(successResponse(game));
    } catch (error) {
      next(error);
    }
  },
);

gamesRouter.post(
  '/:id/abort',
  authGuard,
  validate(gameIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const params = req.params as GameIdParamsInput;
      const game = await gamesService.abort(req.user!.id, params.id);
      res.status(200).json(successResponse(game));
    } catch (error) {
      next(error);
    }
  },
);

export default gamesRouter;

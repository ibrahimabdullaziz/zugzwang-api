import cors from 'cors';
import express, { type Router } from 'express';
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { AppError } from './common/errors/AppError.js';
import { ErrorCode } from './common/errors/codes.js';
import { errorHandler } from './common/middleware/errorHandler.js';
import { successResponse } from './common/utils/apiResponse.js';

export interface AppDependencies {
  routes: Router;
  corsOrigins: readonly string[];
  jsonLimit?: string | number;
}

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: [...deps.corsOrigins] }));
  app.use(express.json({ limit: deps.jsonLimit ?? '1mb' }));
  app.get('/health/live', (_request, response) => {
    response.json(successResponse({ status: 'ok' }));
  });
  app.use(deps.routes);

  const notFoundHandler: RequestHandler = (request, _response, next) => {
    next(
      new AppError(
        ErrorCode.NOT_FOUND,
        404,
        `Route ${request.method} ${request.path} was not found`,
      ),
    );
  };

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/codes.js';
import { errorResponse } from '../utils/apiResponse.js';
import { logger } from '../../config/logger.js';

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    response
      .status(error.httpStatus)
      .json(errorResponse(error.code, error.message, error.details));
    return;
  }

  if (error instanceof ZodError) {
    const fields = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
      code: issue.code,
    }));

    response
      .status(400)
      .json(
        errorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', {
          fields,
        }),
      );
    return;
  }

  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      response
        .status(409)
        .json(
          errorResponse(ErrorCode.CONFLICT, 'A resource with those values already exists'),
        );
      return;
    }

    if (error.code === 'P2025') {
      response
        .status(404)
        .json(errorResponse(ErrorCode.NOT_FOUND, 'The requested resource was not found'));
      return;
    }
  }

  logger.error(
    { err: error, method: request.method, url: request.originalUrl },
    'Unhandled request error',
  );
  response
    .status(500)
    .json(
      errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, 'An unexpected error occurred'),
    );
};

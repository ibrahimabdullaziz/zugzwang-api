import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/codes.js';

export function roleGuard(...allowedRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required.');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Insufficient permissions.');
    }

    next();
  };
}

export default roleGuard;

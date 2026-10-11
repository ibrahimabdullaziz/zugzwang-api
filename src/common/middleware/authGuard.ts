import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/codes.js';
import { verifyAccessToken } from '../security/tokens.js';

export const authGuard: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or missing token.');
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or missing token.');
  }

  const verified = verifyAccessToken(token);

  req.user = {
    id: verified.sub,
    role: verified.role,
  };

  next();
};

export default authGuard;

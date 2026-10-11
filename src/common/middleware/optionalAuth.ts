import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../security/tokens.js';

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) {
      try {
        const verified = verifyAccessToken(token);
        req.user = {
          id: verified.sub,
          role: verified.role,
        };
      } catch {
        req.user = undefined;
      }
    }
  }

  next();
};

export default optionalAuth;

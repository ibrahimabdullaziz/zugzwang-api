import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { authGuard } from '../../common/middleware/authGuard.js';
import { successResponse } from '../../common/utils/apiResponse.js';
import * as authService from './auth.service.js';
import * as usersService from '../users/users.service.js';
import {
  registerInputSchema,
  loginInputSchema,
  refreshTokenSchema,
  type RegisterInputDto,
  type LoginInputDto,
  type RefreshTokenDto,
} from './auth.schema.js';

export const authRouter = Router();

// POST /auth/register
authRouter.post('/register', validate(registerInputSchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as RegisterInputDto;
    const result = await authService.register(body);
    res.status(201).json(successResponse(result));
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
authRouter.post('/login', validate(loginInputSchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as LoginInputDto;
    const result = await authService.login(body);
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
authRouter.post('/refresh', validate(refreshTokenSchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as RefreshTokenDto;
    const result = await authService.refreshTokens(body.refreshToken);
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
authRouter.post('/logout', validate(refreshTokenSchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as RefreshTokenDto;
    await authService.logout(body.refreshToken);
    res.status(200).json(successResponse({ message: 'Logged out successfully.' }));
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout-all
authRouter.post('/logout-all', authGuard, async (req, res, next) => {
  try {
    await authService.logoutAll(req.user!.id);
    res.status(200).json(successResponse({ message: 'All sessions logged out successfully.' }));
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
authRouter.get('/me', authGuard, async (req, res, next) => {
  try {
    const me = await usersService.getProfileById(req.user!.id);
    res.status(200).json(successResponse(me));
  } catch (err) {
    next(err);
  }
});

export default authRouter;

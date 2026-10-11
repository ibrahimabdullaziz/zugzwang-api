import { Router } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { authGuard } from '../../common/middleware/authGuard.js';
import { successResponse } from '../../common/utils/apiResponse.js';
import * as usersService from './users.service.js';
import {
  updateProfileSchema,
  usernameParamSchema,
  type UpdateProfileInput,
} from './users.schema.js';

export const usersRouter = Router();

// PATCH /users/me
usersRouter.patch('/me', authGuard, validate(updateProfileSchema, 'body'), async (req, res, next) => {
  try {
    const body = req.body as UpdateProfileInput;
    const updated = await usersService.updateProfile(req.user!.id, body.username);
    res.status(200).json(successResponse(updated));
  } catch (err) {
    next(err);
  }
});

// GET /users/:username
usersRouter.get('/:username', validate(usernameParamSchema, 'params'), async (req, res, next) => {
  try {
    const profile = await usersService.getProfileByUsername(req.params.username as string);
    res.status(200).json(successResponse(profile));
  } catch (err) {
    next(err);
  }
});

export default usersRouter;

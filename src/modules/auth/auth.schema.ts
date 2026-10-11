import { userSchema } from '../users/users.schema.js';
import { CreateUserInput } from '../users/users.schema.js';
import z from 'zod';

export const registerInputSchema = userSchema;

export const loginInputSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email({ message: 'invalid email address' }),
  password: z
    .string({ error: 'Password is required' })
    .min(8, { message: 'Password must be at least 8 characters' }),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInputDto = CreateUserInput;
export type LoginInputDto = z.infer<typeof loginInputSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

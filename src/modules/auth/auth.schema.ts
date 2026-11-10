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

export const verifyEmailSchema = z.object({
  token: z.string().min(1, { message: 'Invalid token' }),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { message: 'Invalid token' })
    .toLowerCase()
    .email({ message: 'invalid email address' }),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, { message: 'Invalid token' }),
  newPassword: z
    .string({ error: 'Password is required' })
    .min(8, { message: 'Password must be at least 8 characters' }),
});

export type RegisterInputDto = CreateUserInput;
export type LoginInputDto = z.infer<typeof loginInputSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
export type verifyEmailDto = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

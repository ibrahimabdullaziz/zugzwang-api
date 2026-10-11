import z from 'zod';

export const userSchema = z
  .object({
    email: z
      .string({ error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email({ message: 'invalid email address' }),
    username: z
      .string({ error: 'Username is required' })
      .trim()
      .min(3, { message: 'Username must be at least 3 characters' })
      .max(30, { message: 'Username cannot exceed 30 characters' }),
    password: z
      .string({ error: 'Password is required' })
      .min(8, { message: 'Password must be at least 8 characters' }),
  })
  .strict();

export const updateProfileSchema = z.object({
  username: z.string().trim().min(3).max(30),
});

export const usernameParamSchema = z.object({
  username: z.string().trim().min(1),
});

export type CreateUserInput = z.infer<typeof userSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

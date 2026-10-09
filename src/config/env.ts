import { z } from 'zod';

const booleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(z.string().url()).min(1)),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),

    ENGINE_PATH: z.string().trim().min(1).default('stockfish'),
    ENGINE_POOL_SIZE: z.coerce.number().int().min(1).default(2),

    SMTP_HOST: z.string().trim().default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USER: z.string().trim().default(''),
    SMTP_PASS: z.string().default(''),
    SMTP_FROM: z.string().trim().default(''),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

    FEATURE_REGISTRATION: booleanFromEnv.default(false),
    FEATURE_EMAIL: booleanFromEnv.default(false),
    FEATURE_ANALYSIS: booleanFromEnv.default(false),
    FEATURE_METRICS: booleanFromEnv.default(true),
  })
  .superRefine((env, context) => {
    const emailConfigured =
      env.FEATURE_EMAIL ||
      [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS, env.SMTP_FROM].some(
        (value) => value.length > 0,
      );

    if (emailConfigured) {
      for (const [key, value] of [
        ['SMTP_HOST', env.SMTP_HOST],
        ['SMTP_USER', env.SMTP_USER],
        ['SMTP_PASS', env.SMTP_PASS],
        ['SMTP_FROM', env.SMTP_FROM],
      ] as const) {
        if (value.length === 0) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when SMTP is configured',
          });
        }
      }
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `- ${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${details}`);
}

const env = result.data;

export const config = Object.freeze({
  server: Object.freeze({
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    corsOrigins: Object.freeze(env.CORS_ORIGINS),
  }),
  db: Object.freeze({
    url: env.DATABASE_URL,
  }),
  redis: Object.freeze({
    url: env.REDIS_URL,
  }),
  jwt: Object.freeze({
    accessSecret: env.JWT_ACCESS_SECRET,
  }),
  engine: Object.freeze({
    binaryPath: env.ENGINE_PATH,
    poolSize: env.ENGINE_POOL_SIZE,
  }),
  email: Object.freeze({
    host: env.SMTP_HOST || undefined,
    port: env.SMTP_PORT,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM || undefined,
  }),
  logging: Object.freeze({
    level: env.LOG_LEVEL,
  }),
  features: Object.freeze({
    registration: env.FEATURE_REGISTRATION,
    email: env.FEATURE_EMAIL,
    analysis: env.FEATURE_ANALYSIS,
    metrics: env.FEATURE_METRICS,
  }),
});

export type Config = typeof config;

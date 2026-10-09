import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const isDevelopment = config.server.nodeEnv === 'development';
const adapter = new PrismaPg({ connectionString: config.db.url });

export const prisma = new PrismaClient({
  adapter,
  log: [{ emit: 'event', level: 'query' }],
});

if (isDevelopment) {
  prisma.$on('query', ({ query, duration }) => {
    logger.debug({ query, duration }, 'Prisma query');
  });
}

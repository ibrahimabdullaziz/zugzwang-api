import { Queue, type DefaultJobOptions } from 'bullmq';
import { z } from 'zod';
import { bullRedis } from './redis.js';
export enum QueueName {
  EMAIL = 'email',
  ANALYSIS = 'analysis',
  MAINTENANCE = 'maintenance',
}

export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },

  removeOnComplete: {
    count: 1000,
    age: 24 * 3600,
  },
  removeOnFail: {
    count: 5000,
  },
};

export const EmailQueue = new Queue<EmailJobPayload>(QueueName.EMAIL, {
  connection: bullRedis,
  defaultJobOptions,
});

export const AnalysisQueue = new Queue<AnalysisJobPayload>(QueueName.ANALYSIS, {
  connection: bullRedis,
  defaultJobOptions,
});

export const MaintenanceQueue = new Queue<MaintenanceJobPayload>(QueueName.MAINTENANCE, {
  connection: bullRedis,
  defaultJobOptions,
});

export const EmailJobSchema = z.object({
  to: z.string().email(),
  subject: z.string().nonempty(),
  template: z.enum(['verify-email', 'reset-password']),
  context: z.object({
    username: z.string(),
    token: z.string().nonempty(),
    url: z.string().url(),
  }),
});

export const AnalysisJobSchema = z.object({
  gameId: z.string(),
});

export const MaintenanceJobSchema = z.object({
  task: z.enum(['cleanup-waiting', 'purge-tokens', 'abandon-stale']),
});

export type EmailJobPayload = z.infer<typeof EmailJobSchema>;
export type AnalysisJobPayload = z.infer<typeof AnalysisJobSchema>;
export type MaintenanceJobPayload = z.infer<typeof MaintenanceJobSchema>;

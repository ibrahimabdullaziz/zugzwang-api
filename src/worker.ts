import { Worker } from 'bullmq';
import { bullRedis } from './config/redis.js';
import { QueueName } from './config/queues.js';
import { registerWorkerEvents } from './common/queues/workerEvents.js';
import { logger } from './config/logger.js';
import { emailProcessor } from './modules/jobs/processors/email.processor.js';

const emailWorker = new Worker(
  QueueName.EMAIL,
  async (job) => {
    await emailProcessor(job);
  },
  {
    connection: bullRedis,
    concurrency: 5,
  },
);

const maintenanceWorker = new Worker(
  QueueName.MAINTENANCE,
  async (job) => {
    // processor function
  },
  {
    connection: bullRedis,
    concurrency: 1,
  },
);

const analysisWorker = new Worker(
  QueueName.ANALYSIS,
  async (job) => {
    // Process analysis job
  },
  {
    connection: bullRedis,
    concurrency: 2,
  },
);

registerWorkerEvents(emailWorker);
registerWorkerEvents(maintenanceWorker);
registerWorkerEvents(analysisWorker);

let shutdownPromise: Promise<void> | undefined;

function handleShutdown(signal: string) {
  shutdownPromise ??= shutdown(signal).catch((error) => {
    logger.error({ error }, 'Worker shutdown failed');
    process.exitCode = 1;
  });

  return shutdownPromise;
}

export async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down workers');

  await Promise.all([emailWorker.close(), maintenanceWorker.close(), analysisWorker.close()]);
  await bullRedis.quit();
  logger.info('Workers shut down successfully');
}

process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
process.on('SIGINT', () => void handleShutdown('SIGINT'));

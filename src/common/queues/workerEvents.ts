import { Worker } from 'bullmq';
import { logger } from '../../config/logger.js';

export function registerWorkerEvents(worker: Worker) {
  worker.on('completed', (job) => {
    logger.info({ queue: worker.name, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ queue: worker.name, jobId: job?.id, err: err.message }, 'Job failed');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ queue: worker.name, jobId }, 'Job stalled');
  });
}

import { MaintenanceQueue } from '../../../config/queues.js';

export async function scheduleMaintenanceJobs(): Promise<void> {
  await MaintenanceQueue.upsertJobScheduler(
    'cleanup-waiting',
    { pattern: '0 * * * *' },
    {
      name: 'cleanup-waiting',
      data: { task: 'cleanup-waiting' },
    },
  );
  await MaintenanceQueue.upsertJobScheduler(
    'purge-tokens',
    { pattern: '0 * * * *' },
    {
      name: 'purge-tokens',
      data: { task: 'purge-tokens' },
    },
  );
  await MaintenanceQueue.upsertJobScheduler(
    'abandon-stale',
    { pattern: '*/1 * * * *' },
    {
      name: 'abandon-stale',
      data: { task: 'abandon-stale' },
    },
  );
}

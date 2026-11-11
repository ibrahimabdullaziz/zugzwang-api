import { MaintenanceQueue } from './../../config/queues.js';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { AnalysisQueue, EmailQueue } from '../../config/queues.js';
const serverAdapter = new ExpressAdapter();

serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(EmailQueue),
    new BullMQAdapter(MaintenanceQueue),
    new BullMQAdapter(AnalysisQueue),
  ],
  serverAdapter,
});

export const bullBoardRouter = serverAdapter.getRouter();

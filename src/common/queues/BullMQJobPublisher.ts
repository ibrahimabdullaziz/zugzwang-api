import { AnalysisQueue, EmailJobPayload, EmailQueue } from '../../config/queues.js';
import type { JobPublisher } from '../../common/queues/Publisher.js';
export class BullMQJobPublisher implements JobPublisher {
  async publishEmail(payload: EmailJobPayload): Promise<void> {
    await EmailQueue.add('send-email', payload);
  }

  async publishAnalysis(gameId: string): Promise<void> {
    await AnalysisQueue.add(`analyze`, { gameId }, { jobId: `analysis-${gameId}` });
  }
}

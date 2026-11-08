import { EmailJobPayload } from '../../config/queues.js';

export interface JobPublisher {
  publishEmail(payload: EmailJobPayload): Promise<void>;
  publishAnalysis(gameId: string): Promise<void>;
}

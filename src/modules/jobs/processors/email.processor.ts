import type { Job } from 'bullmq';
import type { EmailJobPayload } from '../../../config/queues.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../notifications/mailer.js';

export async function emailProcessor(job: Job<EmailJobPayload>): Promise<void> {
  const { to, template, context } = job.data;

  switch (template) {
    case 'verify-email':
      await sendVerificationEmail(to, context.username, context.token);
      break;

    case 'reset-password':
      await sendPasswordResetEmail(to, context.username, context.token);
      break;
  }
}

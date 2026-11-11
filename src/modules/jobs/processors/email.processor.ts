import type { Job } from 'bullmq';
import type { EmailJobPayload } from '../../../config/queues.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../notifications/mailer.js';
import { prisma } from '../../../db/prisma.js';

export async function emailProcessor(job: Job<EmailJobPayload>): Promise<void> {
  const { to, template, context } = job.data;

  switch (template) {
    case 'verify-email': {
      const user = await prisma.user.findUnique({
        where: { email: to },
        select: { emailVerifiedAt: true },
      });

      if (!user || user.emailVerifiedAt) return;

      await sendVerificationEmail(to, context.username, context.token);
      break;
    }

    case 'reset-password':
      await sendPasswordResetEmail(to, context.username, context.token);
      break;
  }
}

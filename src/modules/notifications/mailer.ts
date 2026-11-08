import nodemailer from 'nodemailer';
import { config } from '../../config/env.js';

export const transporter = nodemailer.createTransport({
  host: config.email.host ?? 'localhost',
  port: config.email.port,
  secure: false,
});

export async function sendVerificationEmail(
  to: string,
  username: string,
  token: string,
): Promise<void> {
  const subject = 'Verify your email address';
  const verifyUrl = `${config.app.url}/auth/verify-email?token=${encodeURIComponent(token)}`;
  const html = `
  <h2> Hello, ${username}</h2> 

  <p>to verify your account from</p><a href='${verifyUrl}'>Here</a>
    `;
  await transporter.sendMail({ from: config.email.from, to, subject, html });
}

export async function sendPasswordResetEmail(
  to: string,
  username: string,
  token: string,
): Promise<void> {
  const subject = 'Reset Your Password';
  const resetUrl = `${config.app.url}/auth/reset-password?token=${encodeURIComponent(token)}`;
  const html = `
  <h2> Hello, ${username}</h2> 

  <p>To reset your account from</p><a href='${resetUrl}'>Here</a>
    `;
  await transporter.sendMail({ from: config.email.from, to, subject, html });
}

import nodemailer from 'nodemailer';

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/STARTTLS
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export function mailConfigured() {
  return !!process.env.SMTP_HOST;
}

export async function sendPasswordResetEmail(to, code) {
  const t = getTransport();
  if (!t) throw new Error('smtp_not_configured');
  await t.sendMail({
    from: process.env.MAIL_FROM || 'PlanForge <no-reply@example.com>',
    to,
    subject: 'Your PlanForge password reset code',
    text: `Your password reset code is: ${code}\n\nThis code expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email.`,
    html: `
      <p>Your password reset code is:</p>
      <p style="font-size:24px;font-family:monospace;letter-spacing:3px;font-weight:bold">${code}</p>
      <p>This code expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

import nodemailer from 'nodemailer';
import 'dotenv/config';
import { query } from './db.js';

// Sends email through any SMTP server (Brevo, Gmail, Resend, Amazon SES...). Configure in .env:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
// Without SMTP_HOST the app runs in TEST MODE: emails are printed in the server terminal instead of sent.
export const TEST_MODE = !process.env.SMTP_HOST;

const transport = TEST_MODE
  ? null
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

const FROM = process.env.MAIL_FROM || 'All Services <no-reply@allservices.local>';

const PURPOSE = {
  login: { subject: 'Your All Services login code', line: 'Use this code to log in' },
  reset: { subject: 'Reset your All Services password', line: 'Use this code to reset your password' },
  verify_email: { subject: 'Confirm your email for All Services', line: 'Use this code to confirm your email address' },
  register: { subject: 'Welcome to All Services — confirm your email', line: 'Welcome! Use this code to confirm your email and create your account' },
};

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function otpHtml({ name, code, purpose, minutes, city }) {
  const p = PURPOSE[purpose];
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#4f46e5;padding:20px 24px;color:#fff;font-size:20px;font-weight:700">All Services</td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 12px">Hi ${escape(name || 'there')},</p>
        <p style="margin:0 0 16px">${p.line}:</p>
        <p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#eef2ff;border-radius:12px;padding:14px">${escape(code)}</p>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px">This code expires in ${minutes} minutes. Never share it with anyone — All Services staff will never ask for it.</p>
        <p style="margin:0;color:#64748b;font-size:14px">Didn't ask for this? You can safely ignore this email.</p>
      </td></tr>
      <tr><td style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px">All Services · ${escape(city)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendOtpEmail({ to, name, code, purpose, minutes = 10 }) {
  const p = PURPOSE[purpose];
  const text = `${p.line}: ${code}\n\nIt expires in ${minutes} minutes. Never share this code with anyone.`;
  if (TEST_MODE) {
    console.log(`\n📧 [TEST MODE — email not sent] To: ${to}\n   ${p.subject}\n   CODE: ${code}\n`);
    return;
  }
  const city = (await query("SELECT value FROM site_settings WHERE key = 'service_city'").catch(() => ({ rows: [] }))).rows[0]?.value || 'Telangana';
  await transport.sendMail({ from: FROM, to, subject: p.subject, text, html: otpHtml({ name, code, purpose, minutes, city }) });
}

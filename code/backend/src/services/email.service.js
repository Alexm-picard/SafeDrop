// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the emailed-invitation request)
// AI-Assisted Areas: invitation email over SMTP (nodemailer) with a log-only fallback for development; HTML-escaped bodies
// Human Contributions: pending team review
// Notes: Verified by tests/integration/routes/invitations.test.js using nodemailer's in-memory JSON transport. Must be reviewed by the owning team member before merge; the Security lead should review what the email says and what is logged.

/**
 * Outbound email, currently one message: the invitation.
 *
 * Mail goes over SMTP through nodemailer, configured by `SMTP_*` in the environment. When `SMTP_HOST`
 * is unset there is nowhere to send it, so the message is **logged instead**, link included, and the
 * caller is told (`'log'`) — that is what lets local development and the tests run with no mail server.
 * Production refuses to boot without `SMTP_HOST` (config/env.js), so the log-only path, which writes a
 * credential to the log, cannot be reached there.
 *
 * Sending is deliberately separate from the database work: callers send *after* their transaction has
 * committed and treat a failure as "the invitation exists but did not go out" rather than rolling the
 * invitation back, because the admin can always resend it.
 *
 * Exports: `sendInvitation`, and `setMailTransport` for tests to capture messages.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let override;
let cached;

/**
 * Replace the mail transport, or restore the configured one with `undefined`.
 *
 * For tests: pass `nodemailer.createTransport({ jsonTransport: true })` to capture messages in memory
 * with no network, or a stub whose `sendMail` rejects to exercise the failure path.
 * @param {import('nodemailer').Transporter|undefined} transport
 */
export function setMailTransport(transport) {
  override = transport;
}

/**
 * The transport to use now: the test override, else one built from the environment, else `null`.
 * @returns {import('nodemailer').Transporter|null}
 */
function transport() {
  if (override) {
    return override;
  }
  if (!env.SMTP_HOST) {
    return null;
  }
  cached ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return cached;
}

/**
 * Escape text for inclusion in an HTML body.
 *
 * Names arrive from users — an admin typing an invitee's name, an organisation's founder naming it — so
 * none of them may be trusted to be free of markup.
 * @param {unknown} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Send (or, without SMTP, log) an invitation.
 *
 * The message carries the one-time link, when it expires, and — because signing in needs an organisation
 * code that a new member has no reason to know — the code and the sign-in address for next time.
 * @param {{ to: { name: string, address: string }, inviterName: string, organization: { name: string, slug: string }, link: string, expiresAt: Date }} invitation
 * @returns {Promise<'email'|'log'>} how it was delivered
 * @throws {Error} whatever the transport raised, when SMTP is configured and the send failed
 */
export async function sendInvitation({ to, inviterName, organization, link, expiresAt }) {
  const mailer = transport();
  const when = expiresAt.toUTCString();
  const signIn = `${env.APP_BASE_URL}/login`;
  const subject = `${inviterName} invited you to ${organization.name} on SafeDrop`;
  const text = [
    `Hi ${to.name},`,
    '',
    `${inviterName} has invited you to join ${organization.name} on SafeDrop.`,
    '',
    'Choose your password to activate your account:',
    link,
    '',
    `This link works once and expires on ${when}. If it has expired, ask ${inviterName} to send a new one.`,
    '',
    `Next time, sign in at ${signIn} with your email and the organization code "${organization.slug}".`,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');
  const html = [
    `<p>Hi ${escapeHtml(to.name)},</p>`,
    `<p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(organization.name)}</strong> on SafeDrop.</p>`,
    `<p><a href="${escapeHtml(link)}">Choose your password</a> to activate your account.</p>`,
    `<p>This link works once and expires on ${escapeHtml(when)}. If it has expired, ask ${escapeHtml(inviterName)} to send a new one.</p>`,
    `<p>Next time, sign in at <a href="${escapeHtml(signIn)}">${escapeHtml(signIn)}</a> with your email and the organization code <strong>${escapeHtml(organization.slug)}</strong>.</p>`,
    `<p>If you weren't expecting this, you can ignore this email.</p>`,
  ].join('\n');

  if (!mailer) {
    logger.warn(
      { to: to.address, link },
      'SMTP is not configured: invitation logged instead of emailed (development only)',
    );
    return 'log';
  }
  await mailer.sendMail({
    from: env.EMAIL_FROM,
    to: { name: to.name, address: to.address },
    subject,
    text,
    html,
  });
  return 'email';
}

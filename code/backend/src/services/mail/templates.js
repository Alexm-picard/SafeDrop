// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: password-reset email copy, plain-text and HTML, with HTML escaping
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * The messages SafeDrop sends, as plain data.
 *
 * Kept apart from the transport so the wording can be reviewed and tested without a provider, and
 * so a template is a pure function: values in, `{ subject, text, html }` out.
 *
 * Every message goes out as both text and HTML. Plain text is not a courtesy here — a reset mail
 * that renders as an empty box in a client that blocks HTML is a support ticket, and spam filters
 * treat HTML-only mail from a new sender worse.
 */

/**
 * Escape the five characters that matter inside HTML text and attribute values.
 *
 * The name comes from user input, so it cannot be interpolated raw into the HTML body. The URL is
 * built by us, but escaping it too costs nothing and keeps the rule simple: nothing reaches the
 * template output unescaped.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The password-reset message (SCRUM-22).
 *
 * The copy states the expiry, because a link that has quietly died is the most common confusion in
 * this flow, and tells the reader to ignore the mail if they did not ask — the only safe advice,
 * since anyone can trigger a send by typing someone else's address.
 * @param {{ name: string, resetUrl: string, expiresInMinutes: number, orgName?: string }} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function passwordResetEmail({ name, resetUrl, expiresInMinutes, orgName }) {
  const where = orgName ? ` for ${orgName}` : '';
  const subject = 'Reset your SafeDrop password';

  const text = [
    `Hi ${name},`,
    '',
    `Someone asked to reset the password on your SafeDrop account${where}.`,
    `Open this link within ${expiresInMinutes} minutes to choose a new one:`,
    '',
    resetUrl,
    '',
    'The link can only be used once.',
    '',
    'If this was not you, you can ignore this message — your password has not changed,',
    'and nobody can use this link without opening it from your inbox.',
  ].join('\n');

  const html = [
    '<!doctype html><html><body style="font-family: system-ui, sans-serif; line-height: 1.5;">',
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Someone asked to reset the password on your SafeDrop account${escapeHtml(where)}.</p>`,
    `<p><a href="${escapeHtml(resetUrl)}">Choose a new password</a> — the link works for ` +
      `${escapeHtml(expiresInMinutes)} minutes and can only be used once.</p>`,
    `<p>If the link does not open, copy this into your browser:<br>` +
      `<span>${escapeHtml(resetUrl)}</span></p>`,
    '<p>If this was not you, you can ignore this message. Your password has not changed.</p>',
    '</body></html>',
  ].join('\n');

  return { subject, text, html };
}

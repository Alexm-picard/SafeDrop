// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: provider-agnostic transactional mail sender (console/Resend/Brevo) over fetch
// Human Contributions: pending team review
// Notes: Written for SCRUM-22 (subtask SCRUM-33). Must be reviewed and tested by the owning team member before merge.

/**
 * Sending transactional mail, behind one function and three transports.
 *
 * The provider is configuration, not code: `MAIL_PROVIDER` picks between `console` (write it to the
 * log, send nothing), `resend` and `brevo`. That is what lets the password-reset flow be written,
 * tested and demonstrated locally before anyone has an account with a provider, and lets the team
 * switch providers — a real possibility given free tiers change — without touching the feature.
 *
 * No SDK. Both providers are one HTTPS POST with a JSON body, and Node 22 has `fetch` built in, so
 * an SDK would add a dependency, a supply-chain surface (SR-13) and a lock-in for no gain.
 *
 * Failures throw. The caller decides what that means: for a password reset it must not become a
 * 500 that tells the world whether the address exists, so see auth.service.
 *
 * Exports: `sendMail`, `sentMail`, `clearSentMail`.
 */
import { env } from '../../config/env.js';
import { logger as defaultLogger } from '../../utils/logger.js';

/**
 * The last few messages the `console` transport "sent".
 *
 * Local development and tests need to see what would have gone out — a reset link is unusable
 * otherwise. Capped so a long-running dev server cannot grow it without bound, and only ever
 * written to by the console transport, so nothing is retained when a real provider is configured.
 * @type {Array<{ to: string, subject: string, text: string, html: string, sentAt: Date }>}
 */
export const sentMail = [];
const SENT_MAIL_LIMIT = 20;

/** Empty the captured-mail buffer. Test helper. @returns {void} */
export function clearSentMail() {
  sentMail.length = 0;
}

/**
 * Split `Name <address@example.test>` into its parts; a bare address works too.
 * @param {string} from
 * @returns {{ name: string|undefined, address: string }}
 */
function parseFrom(from) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match) {
    return { name: match[1] || undefined, address: match[2].trim() };
  }
  return { name: undefined, address: from.trim() };
}

/**
 * POST to a provider and turn a non-2xx into an error that names the provider and status.
 *
 * The response body is read for the log, but truncated: a provider error can echo the payload,
 * which for us includes a recipient's address.
 * @param {string} provider
 * @param {string} url
 * @param {object} init
 * @returns {Promise<void>}
 */
async function post(provider, url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${provider} rejected the message (${response.status}): ${body.slice(0, 200)}`);
  }
}

const transports = {
  /**
   * Log the message instead of sending it, and keep it in `sentMail`.
   * @param {object} message
   * @param {object} logger
   */
  console: (message, logger) => {
    sentMail.push({ ...message, sentAt: new Date() });
    if (sentMail.length > SENT_MAIL_LIMIT) {
      sentMail.shift();
    }
    // The body is logged at debug because it can contain a single-use link: useful locally, and
    // LOG_LEVEL is never debug in a deployed environment.
    logger.info(
      { to: message.to, subject: message.subject },
      'mail not sent (MAIL_PROVIDER=console)',
    );
    logger.debug({ to: message.to, text: message.text }, 'mail body');
    return Promise.resolve();
  },

  /** https://resend.com/docs/api-reference/emails/send-email */
  resend: async (message) => {
    await post('resend', 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.MAIL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
  },

  /** https://developers.brevo.com/reference/sendtransacemail */
  brevo: async (message) => {
    const sender = parseFrom(env.MAIL_FROM);
    await post('brevo', 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.MAIL_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: sender.address, name: sender.name },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
    });
  },
};

/**
 * Send one message through the configured provider.
 *
 * @param {{ to: string, subject: string, text: string, html: string }} message
 * @param {{ provider?: string, logger?: object }} [options] injectable for tests
 * @returns {Promise<void>}
 * @throws {Error} when the provider refuses the message or the request fails
 */
export async function sendMail(
  message,
  { provider = env.MAIL_PROVIDER, logger = defaultLogger } = {},
) {
  const transport = transports[provider];
  if (!transport) {
    throw new Error(`unknown MAIL_PROVIDER "${provider}"`);
  }
  await transport(message, logger);
}

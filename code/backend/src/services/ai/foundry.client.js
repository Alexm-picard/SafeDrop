/**
 * The low-level Microsoft Foundry transport (SCRUM-103, SDD §2.6).
 *
 * One function, `foundryRequest()`, that every AI feature in this folder goes through. It owns the
 * things that must be identical for all of them — authentication, the timeout, how an upstream
 * failure becomes an application error, and what reaches the log — and knows nothing about search,
 * reliability scoring or depreciation. Those build their request bodies and call this.
 *
 * **The key never leaves the backend.** It is read from the environment here and attached per
 * request; no route returns it, and the SPA has no Foundry code at all. That is the rule stated in
 * this folder's README and it is what SR-11 requires of any secret.
 *
 * **Nothing here decides what data to send.** Prompt construction belongs to the caller, because
 * whether a prompt may contain a member's name is a question about that feature, not about HTTP. The
 * one thing this module enforces is that a caller has thought about the tenant: `orgId` is the first
 * argument, the same rule the repository layer follows, so a call cannot be written without naming
 * the organisation it belongs to.
 *
 * **What is logged is deliberately narrow.** The model, a hash of the prompt, the latency and the
 * status — never the prompt itself and never the response. A log line that quoted either would put
 * one tenant's inventory and member names into a shared log stream, which is the leak this feature is
 * most likely to cause and the hardest to notice.
 *
 * Exports: `foundryRequest(orgId, path, body, options)`, `isFoundryEnabled()`, `promptFingerprint()`.
 */
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ component: 'foundry' });

/**
 * Whether Foundry is configured and switched on for this environment.
 *
 * Callers check this and fall back to their non-AI path rather than calling and handling a failure.
 * An AI feature is an enhancement over something that already works — the catalogue search still
 * functions without it — so "off" must be an ordinary state, not an error.
 * @returns {boolean}
 */
export function isFoundryEnabled() {
  return env.FOUNDRY_ENABLED;
}

/**
 * A short, stable fingerprint of a prompt, for correlating log lines without recording the text.
 *
 * Truncated to 16 hex characters: enough to tell two prompts apart when reading a log, far too
 * little to work backwards to the content. This exists so that "the same query is being retried in a
 * loop" is answerable from the logs without those logs holding tenant data.
 * @param {string} prompt
 * @returns {string}
 */
export function promptFingerprint(prompt) {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Call Foundry once and return the parsed JSON body.
 *
 * Every failure mode — a non-2xx response, a timeout, DNS, a malformed body — surfaces as
 * `ServiceUnavailableError` (503) with the original error as its `cause`. That is deliberate: to a
 * member typing in a search box, "the AI service is not answering" is one situation regardless of
 * which layer failed, and the detail belongs in the log rather than in the response. The upstream's
 * own message is never forwarded, since a third party's error text is not ours to show and may
 * quote the request back.
 *
 * The timeout is enforced with `AbortSignal.timeout`, so a hung upstream releases the connection at
 * `FOUNDRY_TIMEOUT_MS` instead of holding a request open until the client gives up.
 * @param {string} orgId the calling organisation, from the verified token — first, as in every repository
 * @param {object} body the request payload, already built by the calling feature
 * @param {{ signal?: AbortSignal, prompt?: string }} [options] `prompt` is used only to compute the log fingerprint
 * @returns {Promise<object>} the parsed response body
 * @throws {ServiceUnavailableError} (503) on any upstream failure, or when Foundry is not enabled
 */
export async function foundryRequest(orgId, body, { signal, prompt } = {}) {
  if (!isFoundryEnabled()) {
    // Reaching here is a programming error — callers are expected to check `isFoundryEnabled()` and
    // take their fallback path — so it is worth failing loudly rather than returning something empty
    // that a caller might render as "no results".
    throw new ServiceUnavailableError('AI features are not enabled in this environment');
  }

  // `api-version` is required: without it this endpoint answers 400 before the agent is ever
  // reached. It is appended here rather than baked into the configured URL so that the version is
  // one named, changeable value instead of a detail buried in whatever someone pasted from the
  // portal. A version already present in the URL wins, so an endpoint can still override it.
  const target = new URL(env.FOUNDRY_ENDPOINT);
  if (!target.searchParams.has('api-version')) {
    target.searchParams.set('api-version', env.FOUNDRY_API_VERSION);
  }
  const url = target.toString();
  const startedAt = Date.now();
  const fields = {
    orgId,
    deployment: env.FOUNDRY_DEPLOYMENT,
    promptHash: prompt ? promptFingerprint(prompt) : undefined,
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key auth. Swap for an Entra bearer token here and nowhere else if the team moves to
        // managed identity — this is the only place the credential is attached.
        'api-key': env.FOUNDRY_API_KEY,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(env.FOUNDRY_TIMEOUT_MS),
    });
  } catch (err) {
    // Network failure, DNS, or the timeout firing. `err` carries the detail; the caller gets a 503.
    log.warn({ ...fields, latencyMs: Date.now() - startedAt, err }, 'foundry request failed');
    throw new ServiceUnavailableError('The AI service is unavailable', err);
  }

  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    // The upstream body is deliberately neither logged nor forwarded. Foundry's error responses quote
    // the offending request back, prompt included, so writing one to the log would put a tenant's
    // inventory and member names into a shared stream — at *any* level, which is why there is no
    // debug-only escape hatch here. The status is enough to tell a quota problem from an outage, and
    // the promptHash is enough to correlate a repeated failure.
    log.warn({ ...fields, latencyMs, status: response.status }, 'foundry returned an error status');
    throw new ServiceUnavailableError(
      'The AI service is unavailable',
      new Error(`Foundry responded ${response.status}`),
    );
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    log.warn({ ...fields, latencyMs, err }, 'foundry returned an unparseable body');
    throw new ServiceUnavailableError('The AI service is unavailable', err);
  }

  log.info({ ...fields, latencyMs, status: response.status }, 'foundry request completed');
  return parsed;
}

/**
 * Unit tests for the Foundry transport (SCRUM-103).
 *
 * `fetch` is stubbed throughout: nothing here reaches the network, so the suite stays fast, runs in
 * CI without credentials, and cannot cost money by accident.
 *
 * The tests worth keeping if any are trimmed are the two about leakage. A prompt carries one tenant's
 * inventory and member names, and an upstream error body can quote that prompt straight back — so
 * "the prompt is never logged" and "the upstream's message is never forwarded to the caller" are the
 * assertions that stop this feature becoming a data leak. Everything else here is plumbing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../src/config/env.js';
import {
  foundryRequest,
  isFoundryEnabled,
  promptFingerprint,
} from '../../../src/services/ai/foundry.client.js';

// The real `env` is frozen by `loadEnv`, which is right in production and makes it unmockable here.
// An unfrozen copy is substituted for the whole suite so a test can describe the environment it is
// testing; every field keeps its real value unless a test changes it.
vi.mock('../../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, env: { ...actual.env } };
});

// Capture what the logger actually writes, rather than spying on its methods: the client takes a
// `logger.child()` at import, and a spy on the parent's methods would never see the child's output.
// The level is forced to `debug` — the suite runs at `fatal`, which would silently drop every line
// and let the "never logs the prompt" assertions pass without a single line to inspect.
const { logLines } = vi.hoisted(() => ({ logLines: [] }));
vi.mock('../../../src/utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logger: actual.createLogger({ level: 'debug', write: (line) => logLines.push(line) }),
  };
});

const ORG_ID = '6aab2a45c6e457e01ac0968a';
const PROMPT = 'laptops available next week for Dana Member';

/** Describe an environment with Foundry switched on and configured. */
function configureFoundry(overrides = {}) {
  Object.assign(env, {
    FOUNDRY_ENABLED: true,
    FOUNDRY_ENDPOINT: 'https://example-foundry.openai.azure.com',
    FOUNDRY_API_KEY: 'test-key-not-a-real-secret',
    FOUNDRY_DEPLOYMENT: 'gpt-4o-test',
    FOUNDRY_TIMEOUT_MS: 10_000,
    ...overrides,
  });
}

/** A `fetch` that resolves to the given status and JSON body. */
const respondWith = (status, body) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

beforeEach(() => {
  vi.restoreAllMocks();
  logLines.length = 0;
  // Back to the shipped default — off — so each test states its own environment rather than
  // inheriting the previous one's.
  Object.assign(env, {
    FOUNDRY_ENABLED: false,
    FOUNDRY_ENDPOINT: '',
    FOUNDRY_API_KEY: '',
    FOUNDRY_DEPLOYMENT: '',
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('isFoundryEnabled', () => {
  it('is false unless the environment switches it on', () => {
    // The default for every environment, including production until someone opts in.
    expect(isFoundryEnabled()).toBe(false);
  });

  it('is true once configured', () => {
    configureFoundry();
    expect(isFoundryEnabled()).toBe(true);
  });
});

describe('promptFingerprint', () => {
  it('is stable for the same prompt and different for a different one', () => {
    expect(promptFingerprint(PROMPT)).toBe(promptFingerprint(PROMPT));
    expect(promptFingerprint(PROMPT)).not.toBe(promptFingerprint(`${PROMPT} `));
  });

  it('does not contain the prompt, and is too short to reverse', () => {
    const hash = promptFingerprint(PROMPT);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).not.toContain('Dana');
  });
});

describe('foundryRequest', () => {
  it('refuses to call anything when Foundry is disabled', async () => {
    // Callers are meant to check isFoundryEnabled() and take their fallback path. Reaching here is a
    // bug, so it fails loudly rather than returning an empty result a caller might render.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(foundryRequest(ORG_ID, '/x', {})).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the configured endpoint with the key in the header, not the URL', async () => {
    configureFoundry();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(respondWith(200, { ok: 1 }));

    await foundryRequest(ORG_ID, '/openai/deployments/gpt-4o-test/chat/completions', { a: 1 });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://example-foundry.openai.azure.com/openai/deployments/gpt-4o-test/chat/completions',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('test-key-not-a-real-secret');
    // A key in the query string ends up in access logs and proxy logs; it belongs in a header only.
    expect(url).not.toContain('test-key-not-a-real-secret');
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it('returns the parsed body on success', async () => {
    configureFoundry();
    vi.spyOn(globalThis, 'fetch').mockImplementation(respondWith(200, { choices: ['x'] }));
    await expect(foundryRequest(ORG_ID, '/x', {})).resolves.toEqual({ choices: ['x'] });
  });

  it('applies a timeout so a hung upstream cannot hold the request open', async () => {
    configureFoundry({ FOUNDRY_TIMEOUT_MS: 1234 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(respondWith(200, {}));

    await foundryRequest(ORG_ID, '/x', {});

    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('turns a non-2xx response into a 503 without forwarding the upstream message', async () => {
    configureFoundry();
    // A real Foundry error body can quote the request — prompt included — straight back at us.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      respondWith(429, { error: { message: `quota exceeded for prompt: ${PROMPT}` } }),
    );

    const err = await foundryRequest(ORG_ID, '/x', {}, { prompt: PROMPT }).catch((e) => e);

    expect(err.status).toBe(503);
    expect(err.message).toBe('The AI service is unavailable');
    expect(err.message).not.toContain('Dana');
    expect(err.message).not.toContain('quota');
    // And it does not reach the log either, at any level — the capture above runs at `debug`, so a
    // debug-only "just for troubleshooting" line would be caught here rather than shipping quietly.
    const logged = logLines.join('\n');
    expect(logged).toContain('429');
    expect(logged).not.toContain('Dana');
    expect(logged).not.toContain('quota exceeded');
  });

  it('turns a network failure or timeout into a 503, keeping the cause for the log', async () => {
    configureFoundry();
    const cause = new Error('The operation was aborted due to timeout');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(cause);

    const err = await foundryRequest(ORG_ID, '/x', {}).catch((e) => e);

    expect(err.status).toBe(503);
    // The detail is kept where operators can see it, and kept out of the response.
    expect(err.cause).toBe(cause);
  });

  it('turns an unparseable body into a 503 rather than a raw JSON error', async () => {
    configureFoundry();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => '<html>gateway</html>',
    });

    await expect(foundryRequest(ORG_ID, '/x', {})).rejects.toMatchObject({ status: 503 });
  });

  it('logs the org, deployment, latency and a prompt hash — never the prompt or the response', async () => {
    configureFoundry();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      respondWith(200, { choices: [{ message: { content: 'Dell XPS held by Dana Member' } }] }),
    );

    await foundryRequest(ORG_ID, '/x', { messages: [{ content: PROMPT }] }, { prompt: PROMPT });

    const serialised = logLines.join('\n');
    expect(logLines).not.toHaveLength(0);
    // What operators need: whose call it was, which model, how slow, and a handle to correlate on.
    expect(serialised).toContain(ORG_ID);
    expect(serialised).toContain('gpt-4o-test');
    expect(serialised).toContain(promptFingerprint(PROMPT));
    // What must never be there: the member's name, the query text, or the model's answer — each of
    // which would put one tenant's data into a shared log stream.
    expect(serialised).not.toContain('Dana');
    expect(serialised).not.toContain('laptops available');
    expect(serialised).not.toContain('Dell XPS');
    // And the credential, which would survive in the log long after the key was rotated.
    expect(serialised).not.toContain('test-key-not-a-real-secret');
  });
});

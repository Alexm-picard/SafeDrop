// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: cookie helpers for supertest: forge a valid access cookie for a seeded user, or log in for real
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Test helpers for authenticating requests and reading cookies back.
 *
 * Two ways to get an authenticated request. `accessCookieFor()` signs a token directly, which is fast
 * and lets a test choose the TTL or the role; `loginAs()` goes through the real login endpoint, which
 * is what a test of the login flow itself needs. Everything else here is for asserting on the
 * `Set-Cookie` headers the API returns.
 */
import request from 'supertest';
import { ACCESS_COOKIE, REFRESH_COOKIE, signAccessToken } from '../../src/utils/tokens.js';

/**
 * Build a Cookie header carrying a freshly signed access token for a seeded user.
 *
 * Skips the login round trip, so a test about authorization does not spend bcrypt time proving
 * authentication again. Accepts either `id` or `_id`, so it takes a Mongoose document or a plain
 * object. `ttl` lets a test mint a nearly-expired token to exercise expiry handling.
 * @param {{ id?: string, _id?: unknown, orgId: unknown, role: string }} user
 * @param {{ ttl?: string }} [options]
 * @returns {string} a `Cookie` header value
 */
export function accessCookieFor(user, { ttl } = {}) {
  const userId = String(user.id ?? user._id);
  const token = signAccessToken(
    { userId, orgId: String(user.orgId), role: user.role },
    ttl ? { ttl } : {},
  );
  return `${ACCESS_COOKIE}=${token}`;
}

/**
 * Parse a response's `Set-Cookie` headers into `{ name: { value, attributes } }`.
 *
 * The attributes are what several security tests assert on — `HttpOnly`, `SameSite`, `Path`,
 * `Max-Age` — so they are kept rather than discarded, lowercased for stable lookup, with valueless
 * flags recorded as `true`.
 * @param {import('supertest').Response} res
 * @returns {Record<string, { value: string, attributes: Record<string, string|true> }>}
 */
export function parseSetCookies(res) {
  const raw = res.headers['set-cookie'] ?? [];
  const out = {};
  for (const line of [].concat(raw)) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const attributes = {};
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      attributes[k.toLowerCase()] = v === undefined ? true : v;
    }
    out[name] = { value, attributes };
  }
  return out;
}

/**
 * Turn a response's `Set-Cookie` headers into a `Cookie` header for the next request.
 *
 * Cleared cookies (empty value) are filtered out, which is what makes this behave like a browser:
 * after logout, the resulting header carries no session, so a follow-up request is genuinely
 * unauthenticated.
 * @param {import('supertest').Response} res
 * @returns {string} a `Cookie` header value
 */
export function cookieHeaderFrom(res) {
  const cookies = parseSetCookies(res);
  return Object.entries(cookies)
    .filter(([, c]) => c.value !== '')
    .map(([name, c]) => `${name}=${c.value}`)
    .join('; ');
}

/**
 * Log in through the real API and return everything a test might assert on.
 *
 * Unlike `accessCookieFor`, this exercises the whole login path — password verification, session
 * creation, cookie attributes — so it is what tests of authentication itself use. The response is
 * returned alongside the cookies so a caller can assert on the status and body too, and the access
 * and refresh cookies are exposed separately for tests that need to present exactly one of them.
 * @param {import('express').Application} app
 * @param {{ orgSlug: string, email: string, password: string }} credentials
 * @returns {Promise<{ res: object, cookies: object, cookieHeader: string, accessCookie: string|null, refreshCookie: string|null }>}
 */
export async function loginAs(app, { orgSlug, email, password }) {
  const res = await request(app).post('/api/auth/login').send({ orgSlug, email, password });
  const cookies = parseSetCookies(res);
  return {
    res,
    cookies,
    cookieHeader: cookieHeaderFrom(res),
    accessCookie: cookies[ACCESS_COOKIE]
      ? `${ACCESS_COOKIE}=${cookies[ACCESS_COOKIE].value}`
      : null,
    refreshCookie: cookies[REFRESH_COOKIE]
      ? `${REFRESH_COOKIE}=${cookies[REFRESH_COOKIE].value}`
      : null,
  };
}

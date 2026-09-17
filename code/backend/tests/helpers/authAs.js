// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: cookie helpers for supertest: forge a valid access cookie for a seeded user, or log in for real
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import request from 'supertest';
import { ACCESS_COOKIE, REFRESH_COOKIE, signAccessToken } from '../../src/utils/tokens.js';

/**
 * Cookie header value carrying a freshly signed access token for a seeded user document.
 * @param {{ id?: string, _id?: unknown, orgId: unknown, role: string }} user
 * @param {{ ttl?: string }} [options]
 */
export function accessCookieFor(user, { ttl } = {}) {
  const userId = String(user.id ?? user._id);
  const token = signAccessToken(
    { userId, orgId: String(user.orgId), role: user.role },
    ttl ? { ttl } : {},
  );
  return `${ACCESS_COOKIE}=${token}`;
}

/** Parse Set-Cookie headers into { name: { value, attributes } }. */
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

/** Build a Cookie request header from a response's Set-Cookie (skips cleared cookies). */
export function cookieHeaderFrom(res) {
  const cookies = parseSetCookies(res);
  return Object.entries(cookies)
    .filter(([, c]) => c.value !== '')
    .map(([name, c]) => `${name}=${c.value}`)
    .join('; ');
}

/** Real login through the API. Returns the response and a ready-to-use Cookie header. */
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

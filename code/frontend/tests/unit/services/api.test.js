// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: fetch wrapper tests: JSON/credentials, ApiError shape, single refresh + single retry on 401, 204 handling
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the HTTP client.
 *
 * Request shape: JSON with credentials included, an empty JSON object for a body-less POST, 204
 * resolving to `undefined`, relative paths resolved against the page origin.
 *
 * Error handling: a typed `ApiError` with code, details and request id, and a non-JSON failure — a
 * proxy error page — wrapped the same way rather than surfacing as a parse error.
 *
 * The session logic is the substantial part: a 401 refreshes once and retries once, gives up after
 * that one retry, never refreshes for the auth endpoints themselves, announces expiry when the
 * refresh fails, and shares a single refresh between concurrent 401s. That last one is not just an
 * optimisation — parallel refreshes would present the same rotated token twice, which the backend
 * treats as token theft and answers by revoking the whole family.
 */
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  errorMessage,
  isApiError,
  resolveUrl,
  sessionEvents,
} from '../../../src/services/api';
import { errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
describe('apiRequest', () => {
  it('sends JSON with credentials and parses the response', async () => {
    let seen = null;
    server.use(
      http.post('*/api/echo', async ({ request }) => {
        seen = {
          method: request.method,
          contentType: request.headers.get('content-type'),
          credentials: request.credentials,
          body: await request.json(),
        };
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(apiRequest('/api/echo', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      ok: true,
    });
    expect(seen).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      credentials: 'include',
      body: { a: 1 },
    });
  });
  it('sends an empty JSON object for a body-less POST and resolves undefined on 204', async () => {
    let body = 'unset';
    server.use(
      http.post('*/api/nobody', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(apiRequest('/api/nobody', { method: 'POST' })).resolves.toBeUndefined();
    expect(body).toEqual({});
  });
  it('resolves relative paths against the page origin (same-origin /api)', () => {
    expect(resolveUrl('/api/x')).toBe(`${window.location.origin}/api/x`);
  });
  it('throws a typed ApiError with code, details and requestId on non-2xx', async () => {
    server.use(
      http.get('*/api/bad', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { location: 'body', path: 'email', message: 'bad email' },
        ]),
      ),
    );
    const err = await apiRequest('/api/bad').catch((e) => e);
    expect(isApiError(err)).toBe(true);
    const api = err;
    expect(api).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'req-test',
    });
    expect(api.fieldErrors()).toEqual({ email: 'bad email' });
    expect(errorMessage(api)).toBe('Invalid request');
  });
  it('wraps non-JSON failures too', async () => {
    server.use(
      http.get(
        '*/api/html',
        () => new HttpResponse('<h1>nope</h1>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );
    const err = await apiRequest('/api/html').catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.code).toBe('HTTP_ERROR');
    expect(errorMessage(new Error(''))).toBe('Something went wrong');
  });
  it('on 401 refreshes once and retries once', async () => {
    let calls = 0;
    let refreshes = 0;
    server.use(
      http.get('*/api/protected', () => {
        calls += 1;
        return calls === 1
          ? errorResponse(401, 'UNAUTHENTICATED', 'expired')
          : HttpResponse.json({ ok: true });
      }),
      http.post('*/api/auth/refresh', () => {
        refreshes += 1;
        return HttpResponse.json({ user: {} });
      }),
    );
    await expect(apiRequest('/api/protected')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(refreshes).toBe(1);
  });
  it('gives up after one retry, never refreshes for auth endpoints, and announces expiry', async () => {
    let refreshes = 0;
    const expired = vi.fn();
    sessionEvents.addEventListener('expired', expired);
    server.use(
      http.get('*/api/protected', () => errorResponse(401, 'UNAUTHENTICATED', 'expired')),
      http.post('*/api/auth/refresh', () => {
        refreshes += 1;
        return errorResponse(401, 'UNAUTHENTICATED', 'dead');
      }),
      http.post('*/api/auth/login', () =>
        errorResponse(401, 'UNAUTHENTICATED', 'Invalid email or password'),
      ),
    );
    const err = await apiRequest('/api/protected').catch((e) => e);
    expect(err.status).toBe(401);
    expect(refreshes).toBe(1);
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(
      apiRequest('/api/auth/login', { method: 'POST', body: {} }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refreshes).toBe(1);
    await expect(apiRequest('/api/protected', { retryOn401: false })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(refreshes).toBe(1);
    sessionEvents.removeEventListener('expired', expired);
  });
  it('shares one refresh between concurrent 401s', async () => {
    let refreshes = 0;
    let attempts = 0;
    server.use(
      http.get('*/api/a', () =>
        attempts++ < 1 ? errorResponse(401, 'UNAUTHENTICATED', 'x') : HttpResponse.json({ a: 1 }),
      ),
      http.get('*/api/b', () =>
        attempts++ < 2 ? errorResponse(401, 'UNAUTHENTICATED', 'x') : HttpResponse.json({ b: 1 }),
      ),
      http.post('*/api/auth/refresh', async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ user: {} });
      }),
    );
    const [a, b] = await Promise.all([apiRequest('/api/a'), apiRequest('/api/b')]);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ b: 1 });
    expect(refreshes).toBe(1);
  });
});

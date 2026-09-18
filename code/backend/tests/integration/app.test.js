// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: cross-cutting middleware behaviour: request id, helmet, CORS allowlist, JSON-only, Origin/Referer/Fetch-Metadata CSRF check, 404/413/400 shapes
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for the app-wide middleware chain (app.js).
 *
 * Covers what every request passes through before it reaches a route: the public `/health` probe,
 * security headers and the request id, the standard 404 shape, the CORS allowlist, the JSON-only rule
 * and the Origin/Referer/Sec-Fetch-Site checks that together defend against CSRF, and the body-parser
 * limits.
 *
 * The assertions are mostly about what the API *refuses*: an arbitrary origin is never reflected, a
 * form-encoded POST is a 415, an oversized body is a 413.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/app.js';

const login = () => request(app).post('/api/auth/login').set('Content-Type', 'application/json');
const creds = { orgSlug: 'nope', email: 'nobody@nowhere.test', password: 'whatever-whatever' };

describe('app-wide middleware', () => {
  it('GET /health is public and carries security headers and a request id', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown routes return the standard 404 shape (401 first for unauthenticated /api calls)', async () => {
    const unauthenticated = await request(app).get('/api/nope');
    expect(unauthenticated.status).toBe(401);
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('CORS reflects only allowlisted origins and never an arbitrary one (SR-14)', async () => {
    const ok = await request(app).get('/health').set('Origin', 'https://app.example.test');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://app.example.test');
  });

  it('state-changing requests must be application/json (415 otherwise)', async () => {
    const text = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const none = await request(app).post('/api/auth/login');
    expect(none.status).toBe(415);
  });

  it('checks Origin, then Referer, then Sec-Fetch-Site on state-changing requests (CSRF, SDD §6.3)', async () => {
    // 401 = passed the origin check and reached the (failing) login; 403 = blocked by the check.
    expect((await login().set('Origin', 'http://localhost:5173').send(creds)).status).toBe(401);
    expect((await login().set('Origin', 'https://evil.example').send(creds)).status).toBe(403);
    expect((await login().set('Origin', 'null').send(creds)).status).toBe(403);
    expect((await login().set('Referer', 'http://localhost:5173/login').send(creds)).status).toBe(
      401,
    );
    expect((await login().set('Referer', 'https://evil.example/page').send(creds)).status).toBe(
      403,
    );
    expect((await login().set('Referer', 'not a url').send(creds)).status).toBe(403);
    expect((await login().set('Sec-Fetch-Site', 'cross-site').send(creds)).status).toBe(403);
    expect((await login().set('Sec-Fetch-Site', 'same-origin').send(creds)).status).toBe(401);
    expect((await login().send(creds)).status).toBe(401);
  });

  it('malformed JSON is 400 and oversized bodies are 413, both in the standard shape', async () => {
    const malformed = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const huge = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ orgSlug: 'x', email: 'a@b.co', password: 'p'.repeat(200_000) }));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a JSON body that is not an object is rejected', async () => {
    const str = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('"just a string"');
    expect(str.status).toBe(400);
    const arr = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('[{"orgId":"x"}]');
    expect(arr.status).toBe(400);
    expect(arr.body.error.code).toBe('VALIDATION_ERROR');
  });
});

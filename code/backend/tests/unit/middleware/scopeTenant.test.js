// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: scopeTenant unit tests: orgId from token only; params/query/body stripped (SR-2)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Unit tests for the tenant-scoping middleware (SR-2).
 *
 * Proves both halves: `req.orgId` comes from the verified token, and any client-supplied tenant key is
 * stripped from params, query and body.
 *
 * The two edge cases matter most. On a public route there is no `req.auth`, so the body is still
 * stripped but `req.orgId` must stay unset — the request must not acquire a tenant it never
 * authenticated for. And a non-object body must pass through untouched rather than throw.
 */
import { describe, expect, it } from 'vitest';
import { scopeTenant } from '../../../src/middleware/scopeTenant.js';

describe('scopeTenant', () => {
  it('copies the verified orgId onto req.orgId and strips client-supplied tenant ids everywhere', () => {
    const req = {
      auth: { userId: 'u1', orgId: 'org-from-token', role: 'MEMBER' },
      params: { id: '1', orgId: 'evil' },
      query: { page: '2', orgId: 'evil', organizationId: 'evil2' },
      body: { name: 'x', orgId: 'evil', org: 'evil3' },
    };
    let called = false;
    scopeTenant(req, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.orgId).toBe('org-from-token');
    expect(req.params).toEqual({ id: '1' });
    expect(req.query).toEqual({ page: '2' });
    expect(req.body).toEqual({ name: 'x' });
  });

  it('strips body orgId even on public routes (no req.auth) and leaves req.orgId unset', () => {
    const req = { params: {}, query: {}, body: { orgName: 'A', orgId: 'evil' } };
    scopeTenant(req, {}, () => {});
    expect(req.body).toEqual({ orgName: 'A' });
    expect(req.orgId).toBeUndefined();
  });

  it('ignores non-object bodies', () => {
    const req = { auth: { orgId: 'o' }, params: {}, query: {}, body: ['a'] };
    scopeTenant(req, {}, () => {});
    expect(req.body).toEqual(['a']);
    expect(req.orgId).toBe('o');
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: every Sprint-1 stub returns 501 with its ticket; skipped acceptance tests name what each ticket must satisfy
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

const stubs = [
  { method: 'GET', path: '/api/assets', as: 'member' },
  {
    method: 'POST',
    path: '/api/assets',
    as: 'admin',
    body: { name: 'Camera', category: 'camera' },
  },
  { method: 'GET', path: '/api/assets/:asset', as: 'member' },
  { method: 'PATCH', path: '/api/assets/:asset', as: 'admin', body: { name: 'Camera 2' } },
  { method: 'POST', path: '/api/assets/:asset/retire', as: 'admin' },
  { method: 'POST', path: '/api/assets/:asset/units', as: 'admin', body: { tag: 'cam-001' } },
  { method: 'GET', path: '/api/requests', as: 'member' },
  {
    method: 'POST',
    path: '/api/requests',
    as: 'member',
    body: { unitId: '0'.repeat(24), neededFrom: '2026-10-01', neededTo: '2026-10-05' },
  },
  { method: 'GET', path: '/api/requests/:request', as: 'member' },
  { method: 'POST', path: '/api/requests/:request/approve', as: 'approver' },
  { method: 'POST', path: '/api/requests/:request/deny', as: 'approver' },
  { method: 'POST', path: '/api/requests/:request/cancel', as: 'member' },
  { method: 'POST', path: '/api/requests/:request/checkout', as: 'approver' },
  { method: 'POST', path: '/api/requests/:request/return', as: 'approver' },
  { method: 'GET', path: '/api/audit', as: 'admin' },
  { method: 'GET', path: '/api/users', as: 'admin' },
  {
    method: 'POST',
    path: '/api/users/invite',
    as: 'admin',
    body: { email: 'new@a.test', name: 'New' },
  },
  { method: 'PATCH', path: '/api/users/:member/role', as: 'admin', body: { role: 'APPROVER' } },
];

const resolvePath = (path, s) =>
  path
    .replace(':asset', String(s.asset._id))
    .replace(':request', String(s.request._id))
    .replace(':member', String(s.member._id));

describe('Sprint 1 stubs answer 501 NOT_IMPLEMENTED with their ticket', () => {
  it.each(stubs)('$method $path', async ({ method, path, as, body }) => {
    const res = await request(app)
      [method.toLowerCase()](resolvePath(path, seed.a))
      .set('Cookie', accessCookieFor(seed.a[as]))
      .set('Content-Type', 'application/json')
      .send(body ?? {});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.details.ticket).toMatch(/^SCRUM-/);
  });

  it('validation still runs before a stub (bad input is 400, not 501)', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: '', category: 'x', bogus: 1 });
    expect(res.status).toBe(400);
  });
});

// ---- Acceptance criteria owned by later tickets. Un-skip when implementing. ----------------------
describe.skip('SCRUM-assets-*: asset catalogue', () => {
  it('GET /api/assets lists only the caller org’s non-retired assets, paginated');
  it(
    'POST /api/assets (ORG_ADMIN) creates an asset and appends ASSET_CREATED in the same transaction',
  );
  it('PATCH /api/assets/:id appends ASSET_UPDATED with before/after snapshots');
  it(
    'POST /api/assets/:id/retire refuses while a unit is OUT or HELD and otherwise appends ASSET_RETIRED',
  );
  it('POST /api/assets/:id/units rejects a duplicate tag within the org with 409');
});

describe.skip('SCRUM-requests-*: checkout workflow (F4 state machine)', () => {
  it(
    'POST /api/requests creates a PENDING request for an AVAILABLE unit and appends REQUEST_SUBMITTED',
  );
  it(
    'approve moves PENDING → APPROVED, sets the unit HELD, appends REQUEST_APPROVED (approver ≠ requester)',
  );
  it('deny moves PENDING → DENIED and appends REQUEST_DENIED');
  it('cancel by the requester moves PENDING/APPROVED → CANCELLED and frees a HELD unit');
  it(
    'checkout (requests:handoff) moves APPROVED → CHECKED_OUT, sets unit OUT and dueAt, appends ASSET_CHECKED_OUT',
  );
  it('return moves CHECKED_OUT/OVERDUE → RETURNED, sets unit AVAILABLE, appends ASSET_RETURNED');
  it('a MEMBER reading another member’s request gets 404');
});

describe.skip('SCRUM-audit-log: GET /api/audit', () => {
  it('returns the org’s events newest-first with page/limit and never another org’s events');
  it('there is no route that can update or delete an audit event (SR-8)');
});

describe.skip('SCRUM-users-*: user management', () => {
  it('POST /api/users/invite creates a user in the admin’s org and appends USER_INVITED');
  it(
    'PATCH /api/users/:id/role re-reads the actor’s role from the database before allowing the change',
  );
  it(
    'PATCH /api/users/:id/role appends USER_ROLE_CHANGED with before/after and refuses to demote the last ORG_ADMIN',
  );
});

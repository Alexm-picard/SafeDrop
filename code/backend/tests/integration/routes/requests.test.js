// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: SCRUM-requests-approve/deny/list — approve and deny a pending checkout request, list requests. SCRUM-requests-checkout/return (record a physical handoff, OD-4)
// Human Contributions: pending team review

/**
 * Integration tests for `/api/requests` — the pieces of the checkout workflow that are implemented.
 *
 * Grows as more of SCRUM-requests-* lands; covers approve/deny and checkout/return so far.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

/** Create a request and drive it straight to APPROVED, bypassing the still-stubbed submit/approve HTTP paths. */
async function createApprovedRequest(org) {
  const created = await checkoutRepo.create(org.orgId, {
    unitId: org.units[0]._id,
    requesterId: org.member._id,
    neededFrom: new Date('2026-10-01T00:00:00Z'),
    neededTo: new Date('2026-10-15T00:00:00Z'),
    note: '',
  });
  return checkoutRepo.transition(org.orgId, created._id, {
    expectedState: 'PENDING',
    patch: { state: 'APPROVED', decidedBy: org.approver._id, decidedAt: new Date() },
  });
}

/** Create a request and drive it straight to CHECKED_OUT. */
async function createCheckedOutRequest(org) {
  const approved = await createApprovedRequest(org);
  return checkoutRepo.transition(org.orgId, approved._id, {
    expectedState: 'APPROVED',
    patch: { state: 'CHECKED_OUT', checkedOutAt: new Date(), dueAt: approved.neededTo },
  });
}

describe('POST /api/requests/:id/approve and /deny (SCRUM-requests-approve, SCRUM-requests-deny)', () => {
  it('approve moves PENDING -> APPROVED, holds the unit, and appends REQUEST_APPROVED', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({ note: 'looks good' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('APPROVED');
    expect(res.body.decidedBy).toBe(String(seed.a.approver._id));

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('HELD');

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_APPROVED });
    expect(audit.total).toBe(1);
    expect(String(audit.items[0].targetId)).toBe(String(seed.a.request._id));
  });

  it('deny moves PENDING -> DENIED with no unit side-effect, and appends REQUEST_DENIED', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/deny`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({ note: 'not eligible' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('DENIED');

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('AVAILABLE');

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_DENIED });
    expect(audit.total).toBe(1);
  });

  it('an APPROVER cannot decide their own request (separation of duties)', async () => {
    const ownRequest = await checkoutRepo.create(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.approver._id,
      neededFrom: new Date('2026-11-01T00:00:00Z'),
      neededTo: new Date('2026-11-05T00:00:00Z'),
      note: '',
    });

    const res = await request(app)
      .post(`/api/requests/${ownRequest._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});

    expect(res.status).toBe(403);
  });

  it('a MEMBER cannot approve or deny', async () => {
    const approveRes = await request(app)
      .post(`/api/requests/${seed.a.request._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(approveRes.status).toBe(403);

    const denyRes = await request(app)
      .post(`/api/requests/${seed.a.request._id}/deny`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(denyRes.status).toBe(403);
  });

  it('a request in another organization returns 404', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.b.request._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('approving an already-decided request returns 409', async () => {
    const first = await request(app)
      .post(`/api/requests/${seed.a.request._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/requests/${seed.a.request._id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('denying an already-decided request returns 409', async () => {
    const first = await request(app)
      .post(`/api/requests/${seed.a.request._id}/deny`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/requests/${seed.a.request._id}/deny`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(second.status).toBe(409);
  });
});

describe('POST /api/requests/:id/checkout (SCRUM-requests-checkout, OD-4)', () => {
  it('moves APPROVED -> CHECKED_OUT, sets the unit OUT and dueAt, and appends ASSET_CHECKED_OUT', async () => {
    const approved = await createApprovedRequest(seed.a);

    const res = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CHECKED_OUT');
    expect(new Date(res.body.dueAt).toISOString()).toBe(approved.neededTo.toISOString());

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('OUT');

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.ASSET_CHECKED_OUT });
    expect(audit.total).toBe(1);
    expect(String(audit.items[0].targetId)).toBe(String(seed.a.units[0]._id));
  });

  it('a MEMBER cannot record a checkout handoff', async () => {
    const approved = await createApprovedRequest(seed.a);
    const res = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(res.status).toBe(403);
  });

  it('a request in another organization returns 404', async () => {
    const approved = await createApprovedRequest(seed.b);
    const res = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(404);
  });

  it('checking out a request that is not APPROVED returns 409', async () => {
    // seed.a.request is still PENDING.
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('checking out the same request twice returns 409 the second time', async () => {
    const approved = await createApprovedRequest(seed.a);
    const first = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(second.status).toBe(409);
  });
});

describe('POST /api/requests/:id/return (SCRUM-requests-return, OD-4)', () => {
  it('moves CHECKED_OUT -> RETURNED, sets the unit AVAILABLE, records the condition, and appends ASSET_RETURNED', async () => {
    const checkedOut = await createCheckedOutRequest(seed.a);

    const res = await request(app)
      .post(`/api/requests/${checkedOut._id}/return`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({ condition: 'FAIR', note: 'minor scuff on the lid' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('RETURNED');
    expect(res.body.returnedAt).toBeTruthy();

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('AVAILABLE');
    expect(unit.condition).toBe('FAIR');

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.ASSET_RETURNED });
    expect(audit.total).toBe(1);
  });

  it('return without a reported condition leaves the unit condition unchanged', async () => {
    const checkedOut = await createCheckedOutRequest(seed.a);
    const before = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);

    const res = await request(app)
      .post(`/api/requests/${checkedOut._id}/return`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});

    expect(res.status).toBe(200);
    const after = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(after.status).toBe('AVAILABLE');
    expect(after.condition).toBe(before.condition);
  });

  it('a MEMBER cannot record a return handoff', async () => {
    const checkedOut = await createCheckedOutRequest(seed.a);
    const res = await request(app)
      .post(`/api/requests/${checkedOut._id}/return`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(res.status).toBe(403);
  });

  it('a request in another organization returns 404', async () => {
    const checkedOut = await createCheckedOutRequest(seed.b);
    const res = await request(app)
      .post(`/api/requests/${checkedOut._id}/return`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(404);
  });

  it('returning a request that is not CHECKED_OUT/OVERDUE returns 409', async () => {
    const approved = await createApprovedRequest(seed.a);
    const res = await request(app)
      .post(`/api/requests/${approved._id}/return`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
  describe('GET /api/requests (SCRUM-requests-list)', () => {
    it("defaults to the caller's own requests for a MEMBER", async () => {
      const res = await request(app)
        .get('/api/requests')
        .set('Cookie', accessCookieFor(seed.a.member));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      expect(res.body.items.every((r) => r.requesterId === String(seed.a.member._id))).toBe(true);
    });

    it("defaults to the caller's own requests for an ORG_ADMIN too, even though the org has more", async () => {
      const res = await request(app)
        .get('/api/requests')
        .set('Cookie', accessCookieFor(seed.a.admin));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    });

    it('scope=org is ignored for a MEMBER: they still get only their own requests', async () => {
      const res = await request(app)
        .get('/api/requests?scope=org')
        .set('Cookie', accessCookieFor(seed.a.member));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
    });

    it('scope=org returns the whole organization for an APPROVER', async () => {
      const res = await request(app)
        .get('/api/requests?scope=org')
        .set('Cookie', accessCookieFor(seed.a.approver));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
    });

    it('scope=org returns the whole organization for an ORG_ADMIN', async () => {
      const res = await request(app)
        .get('/api/requests?scope=org')
        .set('Cookie', accessCookieFor(seed.a.admin));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
    });

    it('state=PENDING narrows the approval queue (scope=org) to the one pending request', async () => {
      const res = await request(app)
        .get('/api/requests?scope=org&state=PENDING')
        .set('Cookie', accessCookieFor(seed.a.approver));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe(String(seed.a.request._id));
      expect(res.body.items[0].state).toBe('PENDING');
    });

    it("state filters a MEMBER's own list too", async () => {
      const res = await request(app)
        .get('/api/requests?state=CHECKED_OUT')
        .set('Cookie', accessCookieFor(seed.a.member));
      expect(res.status).toBe(200);
      // checkedOutRequest and projectorRequest are both CHECKED_OUT, both requested by seed.a.member.
      expect(res.body.total).toBe(2);
      expect(res.body.items.every((r) => r.state === 'CHECKED_OUT')).toBe(true);
    });

    it("never returns another organization's requests even with scope=org", async () => {
      const res = await request(app)
        .get('/api/requests?scope=org')
        .set('Cookie', accessCookieFor(seed.a.admin));
      expect(res.status).toBe(200);
      const ids = res.body.items.map((r) => r.id);
      expect(ids).not.toContain(String(seed.b.request._id));
    });

    it('paginates with page and limit', async () => {
      const res = await request(app)
        .get('/api/requests?scope=org&limit=2&page=2')
        .set('Cookie', accessCookieFor(seed.a.approver));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 5, page: 2, limit: 2 });
      expect(res.body.items).toHaveLength(2);
    });

    it('rejects an unknown state value with 400', async () => {
      const res = await request(app)
        .get('/api/requests?state=BOGUS')
        .set('Cookie', accessCookieFor(seed.a.member));
      expect(res.status).toBe(400);
    });

    it('unauthenticated gets 401', async () => {
      const res = await request(app).get('/api/requests');
      expect(res.status).toBe(401);
    });
  });
});

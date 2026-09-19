// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: SCRUM-requests-approve/deny — approve and deny a pending checkout request
// Human Contributions: pending team review

/**
 * Integration tests for `/api/requests` — the pieces of the checkout workflow that are implemented.
 *
 * Grows as more of SCRUM-requests-* lands (create, cancel, checkout, return); for now it covers
 * approve/deny only.
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

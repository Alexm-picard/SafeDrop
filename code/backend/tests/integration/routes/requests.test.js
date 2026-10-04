// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: SCRUM-135/approve/deny/list — submit, approve and deny a checkout request, list requests. SCRUM-120/return (record a physical handoff, OD-4). SCRUM-123 (request detail). SCRUM-150 restricted equipment: any-of-several groups, AT-3 re-check at approval
// Human Contributions: pending team review

/**
 * Integration tests for `/api/requests` — the pieces of the checkout workflow that are implemented.
 *
 * Grows as more of the checkout epic lands; covers submit, approve/deny, list, checkout/return and
 * the detail read so far.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { AssetUnit } from '../../../src/models/AssetUnit.js';
import { User } from '../../../src/models/User.js';
import * as assetRepo from '../../../src/repositories/asset.repository.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { clearSummaryCache } from '../../../src/services/dashboard.service.js';
import * as groupService from '../../../src/services/group.service.js';
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

describe('POST /api/requests (SCRUM-135)', () => {
  it('creates a PENDING request for an AVAILABLE unit and appends REQUEST_SUBMITTED', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
        note: 'for a demo',
      });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('PENDING');
    expect(res.body.id).toBeTruthy();
    expect(res.body.requesterId).toBe(String(seed.a.member._id));

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_SUBMITTED });
    expect(audit.total).toBe(1);
    expect(String(audit.items[0].targetId)).toBe(res.body.id);
  });

  it('reserves the unit (AVAILABLE -> REQUESTED) on submit', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(res.status).toBe(201);

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.extraAssets[0].units[0]._id);
    expect(unit.status).toBe('REQUESTED');
  });

  it('a second submit for the same now-REQUESTED unit is refused with 409', async () => {
    const first = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-06T00:00:00.000Z',
        neededTo: '2026-11-10T00:00:00.000Z',
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.message).toBe('That unit is no longer available');
  });

  it('denying releases a unit that submit() had reserved back to AVAILABLE', async () => {
    const submitRes = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(submitRes.status).toBe(201);
    expect(
      (await assetUnitRepo.findById(seed.a.orgId, seed.a.extraAssets[0].units[0]._id)).status,
    ).toBe('REQUESTED');

    const denyRes = await request(app)
      .post(`/api/requests/${submitRes.body.id}/deny`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(denyRes.status).toBe(200);
    expect(
      (await assetUnitRepo.findById(seed.a.orgId, seed.a.extraAssets[0].units[0]._id)).status,
    ).toBe('AVAILABLE');
  });

  it('a unit that is not AVAILABLE is refused with a readable 409', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.units[1]._id, // OUT in the fixture
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('That unit is no longer available');
  });

  it('a unit id in another organization returns 404, not 403', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.b.units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a unit id that does not exist returns 404', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: '0'.repeat(24),
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(res.status).toBe(404);
  });

  it('requesterId in the body is rejected before it ever reaches the service (strict schema)', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.units[0]._id,
        requesterId: String(seed.a.admin._id),
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('no audit event is appended when the submit fails', async () => {
    await request(app).post('/api/requests').set('Cookie', accessCookieFor(seed.a.member)).send({
      unitId: seed.a.units[1]._id, // OUT
      neededFrom: '2026-11-01T00:00:00.000Z',
      neededTo: '2026-11-05T00:00:00.000Z',
    });
    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_SUBMITTED });
    expect(audit.total).toBe(0);
  });

  it('rejects a window where neededTo is not after neededFrom', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.units[0]._id,
        neededFrom: '2026-11-05T00:00:00.000Z',
        neededTo: '2026-11-01T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ path: 'neededTo' });
  });
});

describe('POST /api/requests/:id/approve and /deny (SCRUM-119, SCRUM-119)', () => {
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

  it('deny moves PENDING -> DENIED, releases the unit back to AVAILABLE, and appends REQUEST_DENIED', async () => {
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

describe('POST /api/requests/:id/checkout (SCRUM-120, OD-4)', () => {
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

  // SCRUM-205 replaced "a MEMBER cannot record a checkout handoff": the borrower may now record their
  // own pickup, and only *other* members are refused. See custodyConfirmation.test.js (AT-1, AT-2).
  it('a MEMBER cannot record the handoff of a request that is not theirs', async () => {
    const approved = await createApprovedRequest(seed.a);
    const other = await User.create({
      orgId: seed.a.orgId,
      email: 'other-member@a.test',
      name: 'Other member',
      role: 'MEMBER',
      passwordHash: 'x'.repeat(60),
    });
    const res = await request(app)
      .post(`/api/requests/${approved._id}/checkout`)
      .set('Cookie', accessCookieFor(other))
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

describe('POST /api/requests/:id/return (SCRUM-120, OD-4)', () => {
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
});

describe('batched lookups for the request list (UI rework)', () => {
  it('return nothing for an empty id list, without a query', async () => {
    expect(await assetRepo.findByIds(seed.a.orgId, [])).toEqual([]);
    expect(await assetUnitRepo.findByIds(seed.a.orgId, [])).toEqual([]);
  });

  it('de-duplicate ids and stay inside the tenant', async () => {
    const unit = seed.a.units[0];
    const found = await assetUnitRepo.findByIds(seed.a.orgId, [unit._id, String(unit._id)]);
    expect(found).toHaveLength(1);
    expect(await assetUnitRepo.findByIds(seed.b.orgId, [unit._id])).toEqual([]);
    expect(await assetRepo.findByIds(seed.b.orgId, [unit.assetId])).toEqual([]);
  });
});

describe('GET /api/requests (SCRUM-119)', () => {
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

  it('names the requester, asset and unit on every row, so the queue is readable without ids', async () => {
    const res = await request(app)
      .get('/api/requests?scope=org&state=PENDING')
      .set('Cookie', accessCookieFor(seed.a.approver));
    expect(res.status).toBe(200);
    const [row] = res.body.items;
    const unit = await assetUnitRepo.findById(seed.a.orgId, row.unitId);
    expect(row.unit).toEqual({ id: String(unit._id), tag: unit.tag });
    expect(row.asset).toEqual({ id: String(unit.assetId), name: expect.any(String) });
    expect(row.requester).toEqual({
      id: row.requesterId,
      name: expect.any(String),
      email: expect.any(String),
    });
    // An allow-list: nothing else about the requester leaks into the queue.
    expect(Object.keys(row.requester).sort()).toEqual(['email', 'id', 'name']);
  });

  it('overdue=true lists the late loans still marked CHECKED_OUT, matching the dashboard count', async () => {
    // Both fixture due dates are in the past and nothing has run mark-overdue, so the two late loans
    // are still CHECKED_OUT — the case where filtering on state=OVERDUE alone would show nothing.
    clearSummaryCache();
    const [list, summary] = await Promise.all([
      request(app)
        .get('/api/requests?scope=org&overdue=true')
        .set('Cookie', accessCookieFor(seed.a.admin)),
      request(app).get('/api/dashboard/summary').set('Cookie', accessCookieFor(seed.a.admin)),
    ]);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items.every((r) => r.state === 'CHECKED_OUT')).toBe(true);
    expect(list.body.total).toBe(summary.body.overdue);
  });

  it('overdue=true leaves out a LOST request even though its date has passed', async () => {
    const res = await request(app)
      .get('/api/requests?scope=org&overdue=true')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.body.items.map((r) => r.id)).not.toContain(String(seed.a.lostRequest._id));
  });

  it('overdue=true combined with a state narrows to the late requests in that state', async () => {
    const late = await request(app)
      .get('/api/requests?scope=org&overdue=true&state=CHECKED_OUT')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(late.body.total).toBe(2);
    // PENDING can never be late (nothing is due back), so the combination matches nothing.
    const none = await request(app)
      .get('/api/requests?scope=org&overdue=true&state=PENDING')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(none.body.total).toBe(0);
  });

  it("overdue=true works on a member's own list too", async () => {
    const res = await request(app)
      .get('/api/requests?overdue=true')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((r) => r.requesterId === String(seed.a.member._id))).toBe(true);
  });

  it('names nothing rather than failing when the unit or requester no longer exists', async () => {
    await AssetUnit.deleteOne({ _id: seed.a.request.unitId });
    await User.deleteOne({ _id: seed.a.request.requesterId });
    const res = await request(app)
      .get('/api/requests?scope=org&state=PENDING')
      .set('Cookie', accessCookieFor(seed.a.approver));
    expect(res.status).toBe(200);
    const [row] = res.body.items;
    expect(row).toMatchObject({ unit: null, asset: null, requester: null });
  });

  it('answers an empty page without looking anything up', async () => {
    const res = await request(app)
      .get('/api/requests?scope=org&state=LOST&page=99')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
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

describe('GET /api/requests/:id (SCRUM-123)', () => {
  const get = (id, cookie) => request(app).get(`/api/requests/${id}`).set('Cookie', cookie);
  const asMemberA = () => accessCookieFor(seed.a.member);
  const asApproverA = () => accessCookieFor(seed.a.approver);

  it('gives the requester their request with the asset, unit, person and history', async () => {
    // Built here rather than taken from the fixture: the seeded rows carry back-dated decision
    // timestamps, which is fine for them but makes "oldest first" impossible to assert.
    const built = await createCheckedOutRequest(seed.a);
    const res = await get(built._id, asMemberA());

    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({
      id: String(built._id),
      state: 'CHECKED_OUT',
    });
    // The ids are resolved for the screen: a detail page showing raw ObjectIds is useless.
    expect(res.body.unit).toMatchObject({ id: String(built.unitId) });
    expect(res.body.asset).toMatchObject({ id: String(seed.a.asset._id), name: seed.a.asset.name });
    expect(res.body.requester).toEqual({
      id: String(seed.a.member._id),
      name: seed.a.member.name,
      email: seed.a.member.email,
    });
    // Only the fields the screen needs: no password hash, no role, nothing internal.
    expect(Object.keys(res.body.requester).sort()).toEqual(['email', 'id', 'name']);

    // The history reads oldest first and covers what actually happened.
    const events = res.body.timeline.map((entry) => entry.event);
    expect(events).toEqual(['SUBMITTED', 'APPROVED', 'CHECKED_OUT']);
    const times = res.body.timeline.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('lets an approver open anyone’s request in their organization', async () => {
    const res = await get(seed.a.request._id, asApproverA());
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe(String(seed.a.request._id));
  });

  it('answers 404, not 403, for another member’s request (SR-2)', async () => {
    // Asked as a plain member who is not the requester. Org B's member serves: they hold
    // requests:read:own and nothing more, which is the case that must not leak.
    const res = await get(seed.a.request._id, accessCookieFor(seed.b.member));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a request in another organization, even for an approver (SR-2)', async () => {
    const res = await get(seed.b.request._id, asApproverA());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for an id that never existed, in the same shape', async () => {
    const missing = await get('0'.repeat(24), asMemberA());
    const foreign = await get(seed.b.request._id, asMemberA());
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: foreign.body.error.message,
    });
  });

  it('rejects an id that is not an ObjectId with 400', async () => {
    const res = await get('not-an-id', asMemberA());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(app).get(`/api/requests/${seed.a.request._id}`);
    expect(res.status).toBe(401);
  });

  it("a denied request's timeline shows DENIED, not APPROVED", async () => {
    // seed.a.request is PENDING; drive it to DENIED directly, bypassing the HTTP path.
    const denied = await checkoutRepo.transition(seed.a.orgId, seed.a.request._id, {
      expectedState: 'PENDING',
      patch: { state: 'DENIED', decidedBy: seed.a.approver._id, decidedAt: new Date() },
    });
    const res = await get(denied._id, asMemberA());
    expect(res.status).toBe(200);
    expect(res.body.timeline.map((e) => e.event)).toEqual(['SUBMITTED', 'DENIED']);
  });

  it("a cancelled request's timeline includes CANCELLED, using the document's last update time", async () => {
    const cancelled = await checkoutRepo.transition(seed.a.orgId, seed.a.request._id, {
      expectedState: 'PENDING',
      patch: { state: 'CANCELLED' },
    });
    const res = await get(cancelled._id, asMemberA());
    expect(res.status).toBe(200);
    expect(res.body.timeline.map((e) => e.event)).toEqual(['SUBMITTED', 'CANCELLED']);
  });
});

describe('POST /api/requests/:id/cancel (SCRUM-135)', () => {
  it('cancels a PENDING request, releases the unit back to AVAILABLE, and appends REQUEST_CANCELLED', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CANCELLED');

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('AVAILABLE');

    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_CANCELLED });
    expect(audit.total).toBe(1);
  });

  it('cancels an APPROVED request and frees its HELD unit back to AVAILABLE', async () => {
    const approved = await createApprovedRequest(seed.a);

    const res = await request(app)
      .post(`/api/requests/${approved._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CANCELLED');

    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[0]._id);
    expect(unit.status).toBe('AVAILABLE');
  });

  it('a MEMBER cannot cancel another member’s request (404, not 403)', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.b.member))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('an APPROVER cannot cancel a request that is not theirs, even though they can see it', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.a.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});
    expect(res.status).toBe(404);
  });

  it('a request in another organization returns 404', async () => {
    const res = await request(app)
      .post(`/api/requests/${seed.b.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(res.status).toBe(404);
  });

  it('cancelling a CHECKED_OUT request returns 409', async () => {
    const checkedOut = await createCheckedOutRequest(seed.a);
    const res = await request(app)
      .post(`/api/requests/${checkedOut._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('cancelling an already-cancelled request returns 409 the second time', async () => {
    const first = await request(app)
      .post(`/api/requests/${seed.a.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/requests/${seed.a.request._id}/cancel`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});
    expect(second.status).toBe(409);
  });
});

/**
 * Restricted equipment (SCRUM-149, SCRUM-150): an asset with a non-empty `allowedGroupIds` may only
 * be requested by an active member of at least one of those groups. Enforced live in `checkout.service.js`'s `submit()`, before the
 * approval policy is even asked — the TODO it replaced warned specifically that an auto-approving
 * asset must not let eligibility slip through just because nothing is left to approve.
 */
describe('POST /api/requests — restricted equipment (SCRUM-149)', () => {
  /** A fresh restricted asset with one AVAILABLE unit, gated by a brand-new group. */
  async function createRestrictedAsset(admin, { approvalMode } = {}) {
    const { group } = await groupService.createGroup(
      seed.a.orgId,
      { userId: admin._id, role: 'ORG_ADMIN' },
      { name: 'Drone Pilots' },
    );
    const assetRes = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(admin))
      .send({
        name: 'Restricted Drone',
        category: 'drone',
        allowedGroupIds: [group.id],
        ...(approvalMode ? { approvalMode } : {}),
      });
    expect(assetRes.status).toBe(201);
    const unitRes = await request(app)
      .post(`/api/assets/${assetRes.body.id}/units`)
      .set('Cookie', accessCookieFor(admin))
      .send({ tag: 'drone-001' });
    expect(unitRes.status).toBe(201);
    return { group, assetId: assetRes.body.id, unitId: unitRes.body.id };
  }

  const submitFor = (unitId, member) =>
    request(app).post('/api/requests').set('Cookie', accessCookieFor(member)).send({
      unitId,
      neededFrom: '2026-11-01T00:00:00.000Z',
      neededTo: '2026-11-05T00:00:00.000Z',
    });

  it('refuses 403 for a member who is not in the required group, and reserves nothing', async () => {
    const { unitId } = await createRestrictedAsset(seed.a.admin);

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await assetUnitRepo.findById(seed.a.orgId, unitId)).status).toBe('AVAILABLE');
    const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_SUBMITTED });
    expect(audit.total).toBe(0);
  });

  it('succeeds for an active member of the required group', async () => {
    const { group, unitId } = await createRestrictedAsset(seed.a.admin);
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      group.id,
      String(seed.a.member._id),
    );

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('PENDING');
  });

  it('a member removed from the group is subsequently blocked', async () => {
    const { group, unitId } = await createRestrictedAsset(seed.a.admin);
    const admin = { userId: seed.a.admin._id, role: 'ORG_ADMIN' };
    await groupService.addGroupMember(seed.a.orgId, admin, group.id, String(seed.a.member._id));
    await groupService.removeGroupMember(seed.a.orgId, admin, group.id, String(seed.a.member._id));

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(403);
  });

  it('a deactivated member stays blocked even though they are still listed in the group', async () => {
    const { group, unitId } = await createRestrictedAsset(seed.a.admin);
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      group.id,
      String(seed.a.member._id),
    );
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(403);
  });

  it('an ineligible member is blocked even on an auto-approving asset — eligibility is checked before the policy', async () => {
    const { unitId } = await createRestrictedAsset(seed.a.admin, { approvalMode: 'AUTO' });

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(403);
    expect((await assetUnitRepo.findById(seed.a.orgId, unitId)).status).toBe('AVAILABLE');
    const audit = await auditRepo.query(seed.a.orgId, {
      action: AUDIT_ACTION.REQUEST_AUTO_APPROVED,
    });
    expect(audit.total).toBe(0);
  });

  it('an eligible member on an auto-approving restricted asset is auto-approved as normal', async () => {
    const { group, unitId } = await createRestrictedAsset(seed.a.admin, { approvalMode: 'AUTO' });
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      group.id,
      String(seed.a.member._id),
    );

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('APPROVED');
  });

  it('an unrestricted asset (allowedGroupIds empty) is unaffected — the default, open behaviour', async () => {
    const res = await submitFor(seed.a.extraAssets[0].units[0]._id, seed.a.member);
    expect(res.status).toBe(201);
  });

  it('membership of any one of several allowed groups is enough (SCRUM-150)', async () => {
    const { assetId, unitId } = await createRestrictedAsset(seed.a.admin);
    const admin = { userId: seed.a.admin._id, role: 'ORG_ADMIN' };
    const { group: heavy } = await groupService.createGroup(seed.a.orgId, admin, {
      name: 'Heavy Machinery Certified',
    });
    await groupService.addGroupMember(seed.a.orgId, admin, heavy.id, String(seed.a.member._id));
    const asset = await request(app)
      .get(`/api/assets/${assetId}`)
      .set('Cookie', accessCookieFor(seed.a.admin));
    await request(app)
      .patch(`/api/assets/${assetId}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ allowedGroupIds: [...asset.body.allowedGroupIds, heavy.id] })
      .expect(200);

    const res = await submitFor(unitId, seed.a.member);

    expect(res.status).toBe(201);
  });

  /**
   * AT-3 (SCRUM-150, SCRUM-175): eligibility can change between submit and approve — a time-of-check
   * to time-of-use gap — so `approve()` asks again. A refused approval leaves the request PENDING so an
   * approver can still deny it.
   */
  describe('AT-3: eligibility is re-checked at approval', () => {
    /** A PENDING request from the member, who was in the group when they submitted. */
    async function pendingFromEligibleMember() {
      const restricted = await createRestrictedAsset(seed.a.admin);
      const admin = { userId: seed.a.admin._id, role: 'ORG_ADMIN' };
      await groupService.addGroupMember(
        seed.a.orgId,
        admin,
        restricted.group.id,
        String(seed.a.member._id),
      );
      const submitted = await submitFor(restricted.unitId, seed.a.member);
      expect(submitted.status).toBe(201);
      return { ...restricted, admin, requestId: submitted.body.id };
    }

    it('refuses to approve once the requester has left the group, and the request stays PENDING', async () => {
      const { group, admin, unitId, requestId } = await pendingFromEligibleMember();
      await groupService.removeGroupMember(
        seed.a.orgId,
        admin,
        group.id,
        String(seed.a.member._id),
      );

      const res = await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Cookie', accessCookieFor(seed.a.approver))
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('requester is no longer eligible');
      expect((await checkoutRepo.findById(seed.a.orgId, requestId)).state).toBe('PENDING');
      expect((await assetUnitRepo.findById(seed.a.orgId, unitId)).status).toBe('REQUESTED');
      const audit = await auditRepo.query(seed.a.orgId, { action: AUDIT_ACTION.REQUEST_APPROVED });
      expect(audit.total).toBe(0);
    });

    it('the stale request can still be denied', async () => {
      const { group, admin, unitId, requestId } = await pendingFromEligibleMember();
      await groupService.removeGroupMember(
        seed.a.orgId,
        admin,
        group.id,
        String(seed.a.member._id),
      );

      const res = await request(app)
        .post(`/api/requests/${requestId}/deny`)
        .set('Cookie', accessCookieFor(seed.a.approver))
        .send({ note: 'no longer certified' });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('DENIED');
      expect((await assetUnitRepo.findById(seed.a.orgId, unitId)).status).toBe('AVAILABLE');
    });

    it('refuses to approve once the requester has been deactivated', async () => {
      const { requestId } = await pendingFromEligibleMember();
      await User.collection.updateOne(
        { _id: seed.a.member._id },
        { $set: { deactivatedAt: new Date() } },
      );

      const res = await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Cookie', accessCookieFor(seed.a.approver))
        .send({});

      expect(res.status).toBe(409);
    });

    it('approves as normal while the requester is still eligible', async () => {
      const { requestId } = await pendingFromEligibleMember();

      const res = await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Cookie', accessCookieFor(seed.a.approver))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('APPROVED');
    });
  });
});

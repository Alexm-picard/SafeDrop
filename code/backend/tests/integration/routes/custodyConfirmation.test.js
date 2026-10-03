// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (acceptance tests written from the SCRUM-205 story)
// AI-Assisted Areas: integration tests for custody confirmation (SCRUM-205): AT-1..AT-8, the pickup-settings endpoint, the pending-returns scope, and the migration
// Human Contributions: user story, acceptance criteria and answers to its open questions by Orelmis Toribio; pending team review
// Notes: Each describe block is one acceptance test from the story, named by its AT number.

/**
 * Acceptance tests for custody confirmation (SCRUM-205).
 *
 * Each change of custody is recorded by the side that can verify it. The borrower records their own
 * pickup and starts their own return, and someone *other than the borrower* confirms or rejects that
 * return. An organisation whose only Approver or Org Admin is the borrower falls back to
 * self-confirmation, and the audit trail says so. Approvals nobody collects expire.
 *
 * Fixture (seedTwoOrgs): in each org, `heldRequest` is the member's APPROVED request (unit HELD) and
 * `checkedOutRequest` the member's CHECKED_OUT request (unit OUT). `requestFor()` builds a request in
 * any state for any requester, for the cases where the requester has to be an approver or admin.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { down, up } from '../../../migrations/20261004000000-pickup-settings.js';
import app from '../../../src/app.js';
import { Organization } from '../../../src/models/Organization.js';
import { User } from '../../../src/models/User.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { expireApprovals } from '../../../src/services/checkout.service.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

/** A valid body for each confirmer route, so a refusal is the policy's and not the schema's. */
const confirmBody = (path) => (path === 'reject-return' ? { reason: 'never arrived' } : {});

const post = (path, user, body = {}) =>
  request(app).post(path).set('Cookie', accessCookieFor(user)).send(body);
const get = (path, user) => request(app).get(path).set('Cookie', accessCookieFor(user));

/** The audit entries for one action in one organisation, oldest first. */
async function auditFor(org, action) {
  const page = await auditRepo.query(org.orgId, { action });
  return [...page.items].reverse();
}

/**
 * Create a request for the projector's AVAILABLE unit and drive it to `state`, with the unit status
 * that state implies. Arrangement only: it goes through the repository, not the API, so a failure
 * points at the behaviour under test rather than at the setup.
 * @param {object} org one half of seedTwoOrgs
 * @param {{ requester: object, state: 'APPROVED'|'CHECKED_OUT'|'OVERDUE'|'RETURN_PENDING' }} options
 */
async function requestFor(org, { requester, state }) {
  const unit = org.extraAssets[1].units[0];
  let req = await checkoutRepo.create(org.orgId, {
    unitId: unit._id,
    requesterId: requester._id,
    neededFrom: new Date('2026-10-01T00:00:00Z'),
    neededTo: new Date('2026-10-15T00:00:00Z'),
    note: '',
  });
  req = await checkoutRepo.transition(org.orgId, req._id, {
    expectedState: 'PENDING',
    patch: { state: 'APPROVED', decidedBy: org.approver._id, decidedAt: new Date() },
  });
  await assetUnitRepo.updateStatus(org.orgId, unit._id, 'HELD');
  if (state === 'APPROVED') {
    return req;
  }
  req = await checkoutRepo.transition(org.orgId, req._id, {
    expectedState: 'APPROVED',
    patch: { state: 'CHECKED_OUT', checkedOutAt: new Date(), dueAt: req.neededTo },
  });
  await assetUnitRepo.updateStatus(org.orgId, unit._id, 'OUT');
  if (state === 'OVERDUE' || state === 'RETURN_PENDING') {
    req = await checkoutRepo.transition(org.orgId, req._id, {
      expectedState: 'CHECKED_OUT',
      patch:
        state === 'OVERDUE'
          ? { state: 'OVERDUE' }
          : {
              state: 'RETURN_PENDING',
              reportedCondition: 'GOOD',
              returnInitiatedAt: new Date(),
            },
    });
  }
  return req;
}

/** Move the member's CHECKED_OUT fixture request to RETURN_PENDING through the API. */
async function startReturn(org, condition = 'GOOD') {
  const res = await post(`/api/requests/${org.checkedOutRequest._id}/initiate-return`, org.member, {
    condition,
  });
  expect(res.status).toBe(200);
  return res.body;
}

/** Leave `org.admin` as the only active Approver or Org Admin (AT-8). */
const makeAdminSoleConfirmer = (org) =>
  User.updateOne({ _id: org.approver._id }, { $set: { deactivatedAt: new Date() } });

describe('AT-1: pickup can be recorded once by the borrower or any Approver or Org Admin', () => {
  it('the borrower records their own pickup: CHECKED_OUT, unit OUT, audited as self-reported', async () => {
    const res = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.member);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CHECKED_OUT');
    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[2]._id);
    expect(unit.status).toBe('OUT');

    const [entry] = await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT);
    expect(String(entry.actorId)).toBe(String(seed.a.member._id));
    expect(entry.after).toMatchObject({ status: 'OUT', selfReported: true });
  });

  it('an approver records the handoff: audited with their name and selfReported false', async () => {
    const res = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.approver);

    expect(res.status).toBe(200);
    const [entry] = await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT);
    expect(String(entry.actorId)).toBe(String(seed.a.approver._id));
    expect(entry.after.selfReported).toBe(false);
  });

  it('selfReported is true when the requester records it, whatever their role', async () => {
    const own = await requestFor(seed.a, { requester: seed.a.approver, state: 'APPROVED' });

    const res = await post(`/api/requests/${own._id}/checkout`, seed.a.approver);

    expect(res.status).toBe(200);
    const [entry] = await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT);
    expect(entry.after.selfReported).toBe(true);
  });

  it('the other side recording the same pickup gets 409 and the history has one checkout', async () => {
    const first = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.member);
    const second = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.approver);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('This item is already checked out');
    expect(await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT)).toHaveLength(1);
  });

  it('two sides recording at the same moment still produce exactly one checkout', async () => {
    const results = await Promise.all([
      post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.member),
      post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.approver),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT)).toHaveLength(1);
  });
});

describe("AT-2: other members cannot record someone else's pickup", () => {
  it('another member gets 403 and the request stays APPROVED', async () => {
    const other = await User.create({
      orgId: seed.a.orgId,
      email: 'other@a.test',
      name: 'Other member',
      role: 'MEMBER',
      passwordHash: 'x'.repeat(60),
    });

    const res = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, other);

    expect(res.status).toBe(403);
    const after = await checkoutRepo.findById(seed.a.orgId, seed.a.heldRequest._id);
    expect(after.state).toBe('APPROVED');
    expect(await auditFor(seed.a, AUDIT_ACTION.ASSET_CHECKED_OUT)).toHaveLength(0);
  });

  it("a member of another organisation gets 404, and org B's request stays APPROVED", async () => {
    const res = await post(`/api/requests/${seed.b.heldRequest._id}/checkout`, seed.a.member);

    expect(res.status).toBe(404);
    const after = await checkoutRepo.findById(seed.b.orgId, seed.b.heldRequest._id);
    expect(after.state).toBe('APPROVED');
  });
});

describe('AT-3: unclaimed approvals expire', () => {
  // heldRequest's neededFrom is 2026-09-25T00:00Z; with the 48-hour default its window closes at
  // 2026-09-27T00:00Z.
  it('nothing expires while the pickup window is still open', async () => {
    const moved = await expireApprovals(seed.a.orgId, { now: new Date('2026-09-26T23:00:00Z') });

    expect(moved).toBe(0);
    const after = await checkoutRepo.findById(seed.a.orgId, seed.a.heldRequest._id);
    expect(after.state).toBe('APPROVED');
  });

  it('after the window: EXPIRED, unit AVAILABLE, REQUEST_EXPIRED with no human actor', async () => {
    const now = new Date('2026-09-27T01:00:00Z');
    const moved = await expireApprovals(seed.a.orgId, { now });

    expect(moved).toBe(1);
    const after = await checkoutRepo.findById(seed.a.orgId, seed.a.heldRequest._id);
    expect(after.state).toBe('EXPIRED');
    expect(after.expiredAt.toISOString()).toBe(now.toISOString());
    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[2]._id);
    expect(unit.status).toBe('AVAILABLE');

    const [entry] = await auditFor(seed.a, AUDIT_ACTION.REQUEST_EXPIRED);
    expect(entry.actorId).toBeNull();
    expect(entry.actorRole).toBe('SYSTEM');
    expect(String(entry.targetId)).toBe(String(seed.a.heldRequest._id));
    expect(entry.after).toMatchObject({ state: 'EXPIRED', unitStatus: 'AVAILABLE' });
  });

  it("uses the organisation's grace period, not the default", async () => {
    await Organization.updateOne(
      { _id: seed.a.orgId },
      { $set: { 'pickupSettings.graceHours': 12 } },
    );

    const moved = await expireApprovals(seed.a.orgId, { now: new Date('2026-09-25T13:00:00Z') });

    expect(moved).toBe(1);
  });

  it('a second run is a no-op and touches only this organisation', async () => {
    const now = new Date('2026-09-27T01:00:00Z');
    await expireApprovals(seed.a.orgId, { now });
    const again = await expireApprovals(seed.a.orgId, { now });

    expect(again).toBe(0);
    expect(await auditFor(seed.a, AUDIT_ACTION.REQUEST_EXPIRED)).toHaveLength(1);
    const orgB = await checkoutRepo.findById(seed.b.orgId, seed.b.heldRequest._id);
    expect(orgB.state).toBe('APPROVED');
  });

  it('an expired request can no longer be picked up', async () => {
    await expireApprovals(seed.a.orgId, { now: new Date('2026-09-27T01:00:00Z') });

    const res = await post(`/api/requests/${seed.a.heldRequest._id}/checkout`, seed.a.member);

    expect(res.status).toBe(409);
  });

  it('refuses to run without a tenant or a valid clock', async () => {
    await expect(expireApprovals(undefined, { now: new Date() })).rejects.toThrow(TypeError);
    await expect(expireApprovals(seed.a.orgId, { now: 'yesterday' })).rejects.toThrow(TypeError);
  });

  it('POST /api/requests/expire-approvals runs the sweep for an Org Admin', async () => {
    const res = await post('/api/requests/expire-approvals', seed.a.admin);

    // The endpoint uses the server's clock, which is well past the fixture's 2026-09-27 cutoff.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expired: 1 });
  });

  it.each(['member', 'approver'])(
    'POST /api/requests/expire-approvals refuses a %s',
    async (role) => {
      const res = await post('/api/requests/expire-approvals', seed.a[role]);

      expect(res.status).toBe(403);
    },
  );
});

describe('AT-4: starting a return does not end accountability', () => {
  it('moves CHECKED_OUT -> RETURN_PENDING with the reported condition; the unit stays OUT', async () => {
    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/initiate-return`,
      seed.a.member,
      { condition: 'FAIR', note: 'left at the front desk' },
    );

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('RETURN_PENDING');
    expect(res.body.reportedCondition).toBe('FAIR');
    expect(res.body.reportedNote).toBe('left at the front desk');
    expect(res.body.returnInitiatedAt).toBeTruthy();
    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[1]._id);
    expect(unit.status).toBe('OUT');

    const [entry] = await auditFor(seed.a, AUDIT_ACTION.RETURN_INITIATED);
    expect(String(entry.actorId)).toBe(String(seed.a.member._id));
    expect(entry.after).toMatchObject({ state: 'RETURN_PENDING', reportedCondition: 'FAIR' });
  });

  it('works from OVERDUE too, and for a requester of any role', async () => {
    const own = await requestFor(seed.a, { requester: seed.a.admin, state: 'OVERDUE' });

    const res = await post(`/api/requests/${own._id}/initiate-return`, seed.a.admin, {
      condition: 'GOOD',
    });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('RETURN_PENDING');
  });

  it('only the requester can start a return: anyone else gets 404', async () => {
    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/initiate-return`,
      seed.a.approver,
      { condition: 'GOOD' },
    );

    expect(res.status).toBe(404);
  });

  it('requires a reported condition', async () => {
    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/initiate-return`,
      seed.a.member,
      {},
    );

    expect(res.status).toBe(400);
  });

  it('cannot start a return on a request that is not out', async () => {
    const res = await post(
      `/api/requests/${seed.a.heldRequest._id}/initiate-return`,
      seed.a.member,
      {
        condition: 'GOOD',
      },
    );

    expect(res.status).toBe(409);
  });

  it('appears in the pending-returns queue of every Approver and Org Admin except the requester', async () => {
    const own = await requestFor(seed.a, { requester: seed.a.approver, state: 'RETURN_PENDING' });
    await startReturn(seed.a);
    const queue = (user) => get('/api/requests?scope=others&state=RETURN_PENDING', user);

    const forAdmin = await queue(seed.a.admin);
    const forApprover = await queue(seed.a.approver);

    expect(forAdmin.body.items.map((r) => r.id).sort()).toEqual(
      [String(own._id), String(seed.a.checkedOutRequest._id)].sort(),
    );
    expect(forApprover.body.items.map((r) => r.id)).toEqual([String(seed.a.checkedOutRequest._id)]);
  });

  it('scope=others is ignored for a member, who still gets only their own requests', async () => {
    await startReturn(seed.a);

    const res = await get('/api/requests?scope=others', seed.a.member);

    expect(res.status).toBe(200);
    expect(res.body.items.every((r) => r.requesterId === String(seed.a.member._id))).toBe(true);
  });
});

describe('AT-5: a different Approver or Org Admin confirms with the condition they received', () => {
  it('RETURNED, unit AVAILABLE in the received condition, and both conditions audited', async () => {
    await startReturn(seed.a, 'GOOD');

    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/return`,
      seed.a.approver,
      {
        condition: 'POOR',
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('RETURNED');
    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[1]._id);
    expect(unit.status).toBe('AVAILABLE');
    expect(unit.condition).toBe('POOR');

    const [entry] = await auditFor(seed.a, AUDIT_ACTION.ASSET_RETURNED);
    expect(String(entry.actorId)).toBe(String(seed.a.approver._id));
    expect(entry.after).toMatchObject({
      status: 'AVAILABLE',
      reportedCondition: 'GOOD',
      receivedCondition: 'POOR',
      selfConfirmed: false,
    });
  });

  it('the detail screen tells a different confirmer they may confirm', async () => {
    await startReturn(seed.a);

    const res = await get(`/api/requests/${seed.a.checkedOutRequest._id}`, seed.a.admin);

    expect(res.status).toBe(200);
    expect(res.body.canConfirmReturn).toBe(true);
    expect(res.body.timeline.map((e) => e.event)).toContain('RETURN_INITIATED');
  });
});

describe('AT-6: walk-in returns and rejected returns', () => {
  it('a CHECKED_OUT request with no return started can still be returned directly', async () => {
    const res = await post(`/api/requests/${seed.a.checkedOutRequest._id}/return`, seed.a.admin, {
      condition: 'GOOD',
    });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('RETURNED');
  });

  it('rejecting a pending return moves it back to CHECKED_OUT with the reason audited', async () => {
    await startReturn(seed.a);

    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/reject-return`,
      seed.a.approver,
      { reason: 'Nothing was left at the desk' },
    );

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CHECKED_OUT');
    expect(res.body.reportedCondition).toBeNull();
    expect(res.body.returnInitiatedAt).toBeNull();
    const unit = await assetUnitRepo.findById(seed.a.orgId, seed.a.units[1]._id);
    expect(unit.status).toBe('OUT');

    const [entry] = await auditFor(seed.a, AUDIT_ACTION.RETURN_REJECTED);
    expect(String(entry.actorId)).toBe(String(seed.a.approver._id));
    expect(entry.after).toMatchObject({
      state: 'CHECKED_OUT',
      reason: 'Nothing was left at the desk',
    });
  });

  it('a rejection needs a reason', async () => {
    await startReturn(seed.a);

    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/reject-return`,
      seed.a.approver,
      { reason: '   ' },
    );

    expect(res.status).toBe(400);
  });

  it('there is nothing to reject when no return was started', async () => {
    const res = await post(
      `/api/requests/${seed.a.checkedOutRequest._id}/reject-return`,
      seed.a.approver,
      { reason: 'never arrived' },
    );

    expect(res.status).toBe(409);
  });
});

describe('AT-7: members cannot confirm returns, and no one confirms their own', () => {
  it.each(['return', 'reject-return'])(
    'a member calling /%s gets 403, state unchanged',
    async (path) => {
      await startReturn(seed.a);

      const res = await post(
        `/api/requests/${seed.a.checkedOutRequest._id}/${path}`,
        seed.a.member,
        confirmBody(path),
      );

      expect(res.status).toBe(403);
      const after = await checkoutRepo.findById(seed.a.orgId, seed.a.checkedOutRequest._id);
      expect(after.state).toBe('RETURN_PENDING');
    },
  );

  it.each([
    ['return', 'CHECKED_OUT'],
    ['return', 'RETURN_PENDING'],
    ['reject-return', 'RETURN_PENDING'],
  ])(
    'an approver calling /%s on their own %s request gets 403 while an admin exists',
    async (path, state) => {
      const own = await requestFor(seed.a, { requester: seed.a.approver, state });

      const res = await post(
        `/api/requests/${own._id}/${path}`,
        seed.a.approver,
        confirmBody(path),
      );

      expect(res.status).toBe(403);
      const after = await checkoutRepo.findById(seed.a.orgId, own._id);
      expect(after.state).toBe(state);
    },
  );

  it('the detail screen tells the requester they may not confirm their own return', async () => {
    const own = await requestFor(seed.a, { requester: seed.a.approver, state: 'RETURN_PENDING' });

    const res = await get(`/api/requests/${own._id}`, seed.a.approver);

    expect(res.body.canConfirmReturn).toBe(false);
  });

  it('the detail screen never offers confirmation to a member', async () => {
    await startReturn(seed.a);

    const res = await get(`/api/requests/${seed.a.checkedOutRequest._id}`, seed.a.member);

    expect(res.body.canConfirmReturn).toBe(false);
  });
});

describe('AT-8: sole-confirmer fallback', () => {
  it.each(['CHECKED_OUT', 'RETURN_PENDING'])(
    'the only Org Admin may return their own %s request, audited as self-confirmed',
    async (state) => {
      await makeAdminSoleConfirmer(seed.a);
      const own = await requestFor(seed.a, { requester: seed.a.admin, state });

      const res = await post(`/api/requests/${own._id}/return`, seed.a.admin, {
        condition: 'GOOD',
      });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('RETURNED');
      const [entry] = await auditFor(seed.a, AUDIT_ACTION.ASSET_RETURNED);
      expect(entry.after.selfConfirmed).toBe(true);
    },
  );

  it("the asset's history shows the return as self-confirmed", async () => {
    await makeAdminSoleConfirmer(seed.a);
    const own = await requestFor(seed.a, { requester: seed.a.admin, state: 'CHECKED_OUT' });
    await post(`/api/requests/${own._id}/return`, seed.a.admin, {});

    const res = await get(`/api/assets/${seed.a.extraAssets[1].asset._id}/history`, seed.a.admin);

    expect(res.status).toBe(200);
    const returned = res.body.items.find((e) => e.action === AUDIT_ACTION.ASSET_RETURNED);
    expect(returned.after.selfConfirmed).toBe(true);
  });

  it('the detail screen offers the sole admin confirmation of their own return', async () => {
    await makeAdminSoleConfirmer(seed.a);
    const own = await requestFor(seed.a, { requester: seed.a.admin, state: 'RETURN_PENDING' });

    const res = await get(`/api/requests/${own._id}`, seed.a.admin);

    expect(res.body.canConfirmReturn).toBe(true);
  });

  it('a deactivated approver does not count, but an active one does', async () => {
    const own = await requestFor(seed.a, { requester: seed.a.admin, state: 'CHECKED_OUT' });

    const blocked = await post(`/api/requests/${own._id}/return`, seed.a.admin, {});
    expect(blocked.status).toBe(403);

    await makeAdminSoleConfirmer(seed.a);
    const allowed = await post(`/api/requests/${own._id}/return`, seed.a.admin, {});
    expect(allowed.status).toBe(200);
  });
});

describe('GET/PATCH /api/organizations/me/pickup-settings (SCRUM-205)', () => {
  const PATH = '/api/organizations/me/pickup-settings';

  it('reads the 48-hour default', async () => {
    const res = await get(PATH, seed.a.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ graceHours: 48 });
  });

  it('saves a new grace period and audits the change with before and after', async () => {
    const res = await request(app)
      .patch(PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ graceHours: 24 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ graceHours: 24 });
    const [entry] = await auditFor(seed.a, AUDIT_ACTION.ORG_SETTINGS_UPDATED);
    expect(entry.before).toEqual({ pickupSettings: { graceHours: 48 } });
    expect(entry.after).toEqual({ pickupSettings: { graceHours: 24 } });
  });

  it('saving the current value records nothing', async () => {
    await request(app)
      .patch(PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ graceHours: 48 });

    expect(await auditFor(seed.a, AUDIT_ACTION.ORG_SETTINGS_UPDATED)).toHaveLength(0);
  });

  it.each([-1, 1.5, 721, '24'])('rejects graceHours=%j with 400', async (graceHours) => {
    const res = await request(app)
      .patch(PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ graceHours });

    expect(res.status).toBe(400);
  });

  it('is Org Admin only', async () => {
    const res = await get(PATH, seed.a.approver);

    expect(res.status).toBe(403);
  });
});

describe('dashboard overdue count (SCRUM-205)', () => {
  it('a late request whose return is only pending is still counted as overdue', async () => {
    await startReturn(seed.a);

    // The fixture's checked-out request was due 2026-09-24.
    const count = await checkoutRepo.countOverdue(seed.a.orgId, new Date('2026-09-30T00:00:00Z'));

    // Org A also has the projector request, due 2026-09-26 and still CHECKED_OUT.
    expect(count).toBe(2);
  });
});

describe('migration 20261004000000-pickup-settings', () => {
  it('backfills the 48-hour default without overwriting a chosen value, and down removes it', async () => {
    const db = mongoose.connection.db;
    await db
      .collection('organizations')
      .updateOne({ _id: seed.a.org._id }, { $unset: { pickupSettings: '' } });
    await db
      .collection('organizations')
      .updateOne({ _id: seed.b.org._id }, { $set: { 'pickupSettings.graceHours': 6 } });

    await up(db);
    const [a, b] = await Promise.all([
      db.collection('organizations').findOne({ _id: seed.a.org._id }),
      db.collection('organizations').findOne({ _id: seed.b.org._id }),
    ]);
    expect(a.pickupSettings.graceHours).toBe(48);
    expect(b.pickupSettings.graceHours).toBe(6);

    await down(db);
    const after = await db.collection('organizations').findOne({ _id: seed.a.org._id });
    expect(after.pickupSettings).toBeUndefined();
  });
});

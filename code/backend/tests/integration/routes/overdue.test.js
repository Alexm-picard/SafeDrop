// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for the mark-overdue story, Lab 3)
// AI-Assisted Areas: markOverdue against real MongoDB: which requests move, the dueAt boundary,
//   idempotence, tenant isolation, agreement with the dashboard count, and the admin endpoint
// Human Contributions: pending team review (Orelmis Toribio)

/**
 * Integration tests for marking late checkouts OVERDUE (mark-overdue story).
 *
 * Built on `seedTwoOrgs()`, whose dates are fixed. In each organisation:
 *   - `checkedOutRequest` is CHECKED_OUT, due 2026-09-24
 *   - `projectorRequest`  is CHECKED_OUT, due 2026-09-26
 *   - `lostRequest`       is LOST, due 2026-08-15 — past due, but in a state that must not move
 *   - `heldRequest` is APPROVED and `request` is PENDING, neither with a due date
 * So `now = 2026-09-25` should move exactly one request per organisation.
 *
 * Every service call passes `now` explicitly. Only the endpoint reads the real clock, and by then
 * both fixture due dates are in the past, so its expected count does not drift as the calendar does.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { AssetUnit } from '../../../src/models/AssetUnit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { CheckoutRequest } from '../../../src/models/CheckoutRequest.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { markOverdue } from '../../../src/services/checkout.service.js';
import { REQUEST_STATE, UNIT_STATUS } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

const at = (iso) => new Date(iso);
const stateOf = async (req) => (await CheckoutRequest.findById(req._id).lean()).state;

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

describe('markOverdue: which requests move', () => {
  it('moves the one checked-out request past its due date, and reports 1', async () => {
    const moved = await markOverdue(seed.a.orgId, { now: at('2026-09-25T00:00:00Z') });

    expect(moved).toBe(1);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.OVERDUE);
    // Due tomorrow relative to `now`, so not late yet.
    expect(await stateOf(seed.a.projectorRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('moves every late checkout once both due dates have passed', async () => {
    const moved = await markOverdue(seed.a.orgId, { now: at('2026-09-27T00:00:00Z') });

    expect(moved).toBe(2);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.OVERDUE);
    expect(await stateOf(seed.a.projectorRequest)).toBe(REQUEST_STATE.OVERDUE);
  });

  it('moves nothing before any due date', async () => {
    expect(await markOverdue(seed.a.orgId, { now: at('2026-09-20T00:00:00Z') })).toBe(0);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('leaves requests in every other state alone, even when their date has long passed', async () => {
    await markOverdue(seed.a.orgId, { now: at('2027-01-01T00:00:00Z') });

    // LOST was due 2026-08-15: late by any measure, but LOST → OVERDUE is not a legal move.
    expect(await stateOf(seed.a.lostRequest)).toBe(REQUEST_STATE.LOST);
    expect(await stateOf(seed.a.heldRequest)).toBe(REQUEST_STATE.APPROVED);
    expect(await stateOf(seed.a.request)).toBe(REQUEST_STATE.PENDING);
  });
});

describe('markOverdue: the dueAt boundary', () => {
  it('does not move a request at the exact instant it falls due (dueAt === now)', async () => {
    // checkedOutRequest is due at exactly this instant: due now is not yet late.
    expect(await markOverdue(seed.a.orgId, { now: at('2026-09-24T00:00:00.000Z') })).toBe(0);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('moves it one millisecond later', async () => {
    expect(await markOverdue(seed.a.orgId, { now: at('2026-09-24T00:00:00.001Z') })).toBe(1);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.OVERDUE);
  });
});

describe('markOverdue: side effects', () => {
  it('leaves the unit OUT: the item is still with the borrower', async () => {
    const unitId = seed.a.checkedOutRequest.unitId;
    await markOverdue(seed.a.orgId, { now: at('2026-09-25T00:00:00Z') });
    expect((await AssetUnit.findById(unitId).lean()).status).toBe(UNIT_STATUS.OUT);
  });

  it('writes no audit events (the move is derived from dueAt, which is already on record)', async () => {
    const before = await AuditEvent.countDocuments({});
    await markOverdue(seed.a.orgId, { now: at('2027-01-01T00:00:00Z') });
    expect(await AuditEvent.countDocuments({})).toBe(before);
  });
});

describe('markOverdue: idempotence', () => {
  it('moves 0 and changes nothing when run a second time with the same now', async () => {
    const now = at('2026-09-27T00:00:00Z');
    expect(await markOverdue(seed.a.orgId, { now })).toBe(2);
    const afterFirst = await CheckoutRequest.find({ orgId: seed.a.orgId }).sort({ _id: 1 }).lean();

    expect(await markOverdue(seed.a.orgId, { now })).toBe(0);
    const afterSecond = await CheckoutRequest.find({ orgId: seed.a.orgId }).sort({ _id: 1 }).lean();
    // Whole documents, updatedAt included: a no-op run must not so much as touch a timestamp.
    expect(afterSecond).toEqual(afterFirst);
  });
});

describe('markOverdue: tenant isolation (SR-2)', () => {
  it("never touches another organisation's requests", async () => {
    const otherBefore = await CheckoutRequest.find({ orgId: seed.b.orgId }).sort({ _id: 1 }).lean();

    expect(await markOverdue(seed.a.orgId, { now: at('2027-01-01T00:00:00Z') })).toBe(2);

    const otherAfter = await CheckoutRequest.find({ orgId: seed.b.orgId }).sort({ _id: 1 }).lean();
    expect(otherAfter).toEqual(otherBefore);
    expect(await stateOf(seed.b.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });
});

describe('markOverdue: agrees with the dashboard count', () => {
  it.each([
    '2026-09-20T00:00:00Z',
    '2026-09-24T00:00:00Z',
    '2026-09-24T00:00:00.001Z',
    '2026-09-25T00:00:00Z',
    '2026-09-27T00:00:00Z',
    '2027-01-01T00:00:00Z',
  ])('at %s, moves exactly the requests countOverdue calls late', async (iso) => {
    const now = at(iso);
    const lateBefore = await checkoutRepo.countOverdue(seed.a.orgId, now);

    expect(await markOverdue(seed.a.orgId, { now })).toBe(lateBefore);
    // Moving CHECKED_OUT → OVERDUE must not change what the dashboard reports as late.
    expect(await checkoutRepo.countOverdue(seed.a.orgId, now)).toBe(lateBefore);
  });
});

describe('POST /api/requests/mark-overdue', () => {
  const post = (user, body = {}) => {
    const req = request(app).post('/api/requests/mark-overdue');
    if (user) {
      req.set('Cookie', accessCookieFor(user));
    }
    return req.set('Content-Type', 'application/json').send(body);
  };
  it("lets an Org Admin mark their organisation's late checkouts, and reports the count", async () => {
    // Both fixture due dates (Sept 24 and 26, 2026) are behind the real clock.
    const res = await post(seed.a.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.OVERDUE);
    expect(await stateOf(seed.a.projectorRequest)).toBe(REQUEST_STATE.OVERDUE);
  });

  it("only acts on the caller's own organisation", async () => {
    await post(seed.a.admin);
    expect(await stateOf(seed.b.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
    expect(await stateOf(seed.b.projectorRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('answers 0 on a second call', async () => {
    await post(seed.a.admin);
    const res = await post(seed.a.admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it.each(['approver', 'member'])('refuses a %s with 403 and moves nothing', async (role) => {
    const res = await post(seed.a[role]);
    expect(res.status).toBe(403);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const res = await post(null);
    expect(res.status).toBe(401);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });

  it('does not let the caller choose the instant: a body with `now` is a 400', async () => {
    // Otherwise an admin could back-date the sweep and hold late items off the list.
    const res = await post(seed.a.admin, { now: '2026-09-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(await stateOf(seed.a.checkedOutRequest)).toBe(REQUEST_STATE.CHECKED_OUT);
  });
});

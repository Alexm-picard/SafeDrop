// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: SCRUM-103 dashboard summary: counts from AssetUnit.status, ORG_ADMIN only;
//   SCRUM-102 pending/overdue counts, 30-day activity series, 60-second cache, AT1 + AT2
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Integration tests for `GET /api/dashboard/summary` (SCRUM-103, SCRUM-102).
 *
 * The suite proves the whole stack end to end — route, permission, controller, service, repository
 * aggregations — and pins the counting rules the story argues about: retired units are out of
 * `totalAssets`, "overdue" means a loan still out past its due date rather than any late request,
 * and the activity series has one bucket per day whether or not anything happened in it.
 *
 * Nothing here asserts against the fixture's hard-coded 2026 dates for the time-sensitive numbers.
 * Those tests set their own dates relative to now, and measure the *change* they cause, so the suite
 * still passes when it is run a month after the fixture was written.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { clearSummaryCache } from '../../../src/services/dashboard.service.js';
import { REQUEST_STATE, UNIT_STATUS } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Midnight UTC `days` ago — the bucket a checkout on that day falls into. */
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);
const isoDay = (date) => date.toISOString().slice(0, 10);

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
  // The summary is cached for a minute; every test here changes the data underneath it.
  clearSummaryCache();
});

/**
 * Read the summary as the given org's admin, with the cache cleared so the call hits the database.
 * @param {object} org one side of the fixture (`seed.a` or `seed.b`)
 */
async function readSummary(org) {
  clearSummaryCache();
  const res = await request(app)
    .get('/api/dashboard/summary')
    .set('Cookie', accessCookieFor(org.admin));
  expect(res.status).toBe(200);
  return res.body;
}

/**
 * Put a unit in someone's hands: a request created, approved and handed over, with the checkout and
 * due dates the caller wants. Mirrors the transitions the real checkout service performs.
 */
async function checkOutUnit(orgId, { unitId, requesterId, checkedOutAt, dueAt }) {
  const created = await checkoutRepo.create(orgId, {
    unitId,
    requesterId,
    neededFrom: checkedOutAt,
    neededTo: dueAt,
    note: '',
  });
  await checkoutRepo.transition(orgId, created._id, {
    expectedState: REQUEST_STATE.PENDING,
    patch: { state: REQUEST_STATE.APPROVED, decidedAt: checkedOutAt },
  });
  return checkoutRepo.transition(orgId, created._id, {
    expectedState: REQUEST_STATE.APPROVED,
    patch: { state: REQUEST_STATE.CHECKED_OUT, checkedOutAt, dueAt },
  });
}

describe('GET /api/dashboard/summary (SCRUM-103)', () => {
  it('returns the inventory counts for the admin’s org', async () => {
    const body = await readSummary(seed.a);
    expect(body).toMatchObject({
      totalAssets: 7,
      checkedOut: 2,
      available: 3,
      held: 1,
      retired: 1,
      requested: 1,
    });
  });

  it('excludes retired units from totalAssets', async () => {
    await assetUnitRepo.create(seed.a.orgId, {
      assetId: seed.a.asset._id,
      tag: 'a-retired',
      status: UNIT_STATUS.RETIRED,
    });
    expect(await readSummary(seed.a)).toMatchObject({ totalAssets: 7, retired: 2 });
  });

  it('returns zeros for an organisation without units', async () => {
    const empty = await request(app).post('/api/organizations').send({
      orgName: 'Empty Org',
      adminName: 'E',
      adminEmail: 'e@empty.test',
      adminPassword: 'Correct-Horse-Battery-9',
    });
    const cookie = empty.headers['set-cookie']
      .find((c) => c.startsWith('sd_access='))
      .split(';')[0];
    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalAssets: 0,
      checkedOut: 0,
      available: 0,
      held: 0,
      retired: 0,
      pendingRequests: 0,
      overdue: 0,
    });
    expect(res.body.activity).toHaveLength(30);
    expect(res.body.activity.every((day) => day.checkouts === 0)).toBe(true);
  });

  it.each(['member', 'approver'])('%s gets 403', async (who) => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Cookie', accessCookieFor(seed.a[who]));
    expect(res.status).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/summary: pending and overdue (SCRUM-102)', () => {
  it('counts the requests still waiting on a decision', async () => {
    expect(await readSummary(seed.a)).toMatchObject({ pendingRequests: 1 });
    await checkoutRepo.create(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      neededFrom: daysAgo(0),
      neededTo: daysAgo(-7),
      note: '',
    });
    expect(await readSummary(seed.a)).toMatchObject({ pendingRequests: 2 });
  });

  it('counts a checkout whose due date has passed, and not one still in date', async () => {
    const before = await readSummary(seed.a);
    await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(10),
      dueAt: daysAgo(3),
    });
    await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.extraAssets[0].units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(2),
      dueAt: daysAgo(-5),
    });
    expect(await readSummary(seed.a)).toMatchObject({ overdue: before.overdue + 1 });
  });

  it('does not count a late loan that has already come back, or one never handed over', async () => {
    const before = await readSummary(seed.a);
    const returned = await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(10),
      dueAt: daysAgo(3),
    });
    await checkoutRepo.transition(seed.a.orgId, returned._id, {
      expectedState: REQUEST_STATE.CHECKED_OUT,
      patch: { state: REQUEST_STATE.RETURNED, returnedAt: daysAgo(1) },
    });
    // A PENDING request has no dueAt at all: it cannot be late, because nothing has left the shelf.
    await checkoutRepo.create(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      neededFrom: daysAgo(20),
      neededTo: daysAgo(10),
      note: '',
    });
    expect(await readSummary(seed.a)).toMatchObject({ overdue: before.overdue });
  });

  it('counts a request the overdue sweep has already moved to OVERDUE', async () => {
    const before = await readSummary(seed.a);
    const late = await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(10),
      dueAt: daysAgo(3),
    });
    await checkoutRepo.transition(seed.a.orgId, late._id, {
      expectedState: REQUEST_STATE.CHECKED_OUT,
      patch: { state: REQUEST_STATE.OVERDUE },
    });
    expect(await readSummary(seed.a)).toMatchObject({ overdue: before.overdue + 1 });
  });

  it('never counts another organisation’s requests (SR-2)', async () => {
    const before = await readSummary(seed.a);
    await checkOutUnit(seed.b.orgId, {
      unitId: seed.b.units[0]._id,
      requesterId: seed.b.member._id,
      checkedOutAt: daysAgo(10),
      dueAt: daysAgo(3),
    });
    await checkoutRepo.create(seed.b.orgId, {
      unitId: seed.b.units[0]._id,
      requesterId: seed.b.member._id,
      neededFrom: daysAgo(0),
      neededTo: daysAgo(-7),
      note: '',
    });
    expect(await readSummary(seed.a)).toMatchObject({
      overdue: before.overdue,
      pendingRequests: before.pendingRequests,
    });
  });
});

describe('GET /api/dashboard/summary: 30-day activity (SCRUM-102)', () => {
  it('returns one bucket per day, oldest first, ending today', async () => {
    const { activity } = await readSummary(seed.a);
    expect(activity).toHaveLength(30);
    expect(activity.at(-1).date).toBe(isoDay(daysAgo(0)));
    expect(activity[0].date).toBe(isoDay(daysAgo(29)));
    const dates = activity.map((day) => day.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('counts a checkout on the day it was handed over', async () => {
    const before = await readSummary(seed.a);
    const day = isoDay(daysAgo(3));
    const baseline = before.activity.find((d) => d.date === day).checkouts;
    await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(3),
      dueAt: daysAgo(-4),
    });
    const { activity } = await readSummary(seed.a);
    expect(activity.find((d) => d.date === day).checkouts).toBe(baseline + 1);
  });

  it('ignores checkouts older than the window', async () => {
    const before = await readSummary(seed.a);
    const total = (summary) => summary.activity.reduce((sum, d) => sum + d.checkouts, 0);
    await checkOutUnit(seed.a.orgId, {
      unitId: seed.a.units[0]._id,
      requesterId: seed.a.member._id,
      checkedOutAt: daysAgo(40),
      dueAt: daysAgo(33),
    });
    expect(total(await readSummary(seed.a))).toBe(total(before));
  });
});

describe('GET /api/dashboard/summary: caching (SCRUM-102)', () => {
  it('serves the cached figures within the TTL and recomputes once it is cleared', async () => {
    const cookie = accessCookieFor(seed.a.admin);
    clearSummaryCache();
    const first = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    await assetUnitRepo.create(seed.a.orgId, {
      assetId: seed.a.asset._id,
      tag: 'a-new',
      status: UNIT_STATUS.AVAILABLE,
    });
    const cached = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(cached.body).toEqual(first.body);
    clearSummaryCache();
    const fresh = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(fresh.body.totalAssets).toBe(first.body.totalAssets + 1);
  });

  it('caches per organisation, never across them', async () => {
    clearSummaryCache();
    await request(app).get('/api/dashboard/summary').set('Cookie', accessCookieFor(seed.a.admin));
    await assetUnitRepo.create(seed.b.orgId, {
      assetId: seed.b.asset._id,
      tag: 'b-new',
      status: UNIT_STATUS.AVAILABLE,
    });
    // Org B has never been cached, so its own read is fresh and includes the unit just added.
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Cookie', accessCookieFor(seed.b.admin));
    expect(res.body).toMatchObject({ totalAssets: 8, available: 4 });
  });
});

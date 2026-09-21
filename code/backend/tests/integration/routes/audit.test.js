/**
 * Integration tests for `GET /api/audit` (SCRUM-46, user story 4).
 *
 * The three acceptance tests from the story map onto the three describes below: AT-1 that filters
 * narrow the log exactly, AT-2 that a filter value cannot become a query operator, AT-3 that a
 * member cannot read the organisation-wide log at all.
 *
 * **On AT-2, the story asks for one defence and the code has three.** A filter submitted as
 * `?actorId[$gt]=` is refused before it can reach a query builder, and it is worth recording which
 * layer refuses what, because a later change could remove one of them and leave the endpoint looking
 * just as safe:
 *
 *  1. `app.set('query parser', 'simple')` parses `?a[$ne]=1` as the single flat key `a[$ne]`, so the
 *     request never becomes a nested object in the first place. The `extended` parser would hand a
 *     ready-made Mongo operator to the validation layer.
 *  2. The route schema is made strict by `validate.strictify()`, so that flat key is an unrecognised
 *     parameter and the request is refused rather than the filter being quietly ignored — which is
 *     the failure mode worth guarding against, since a silently dropped filter returns *more* rows
 *     than the caller asked for, not fewer.
 *  3. `assertNoMongoOperators` rejects any key starting with `$` or containing `.` outright.
 *
 * Each of the three is asserted separately below, by the distinct error each one produces.
 *
 * **Timestamps cannot be chosen by the caller.** `AuditEvent` re-stamps `timestamp` on every insert
 * path (SR-8), so a test cannot place a row in September to match the story's literal dates. The
 * date-range tests therefore build their ranges relative to now and assert on what falls inside and
 * outside them, which is the behaviour the criterion is really about and does not rot as the fixture
 * ages.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

/**
 * How many entries the story's scenario puts in the log, and how many of them are the member's.
 *
 * The story says 200 entries of which 40 belong to one person; those proportions are kept because
 * the point of the criterion is that a filter picks a minority out of a large log, and a test over
 * five rows would pass just as happily with a broken filter.
 */
const MEMBER_EVENTS = 40;
const OTHER_EVENTS = 160;

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

/** Read the audit log as the given seeded user. */
const auditAs = (user, query = '') =>
  request(app).get(`/api/audit${query}`).set('Cookie', accessCookieFor(user));

/**
 * Append `count` events for one actor, in parallel.
 *
 * Parallel is safe here and everywhere else in this file: nothing asserts on the order of these
 * rows, only on which of them a filter selects. Ordering is `assetHistory.test.js`'s concern.
 * @param {object} org one half of the `seedTwoOrgs` fixture
 * @param {{ actor: object, count: number, action: string, targetType: string, targetId: unknown }} spec
 */
const appendMany = (org, { actor, count, action, targetType, targetId }) =>
  Promise.all(
    Array.from({ length: count }, () =>
      auditRepo.append(org.orgId, {
        actorId: actor._id,
        actorRole: actor.role,
        action,
        targetType,
        targetId,
      }),
    ),
  );

/**
 * Build the story's log: a large organisation-wide history in which one member made 40 of the moves.
 *
 * The 160 other entries are split between the admin and the approver so that "no entry from another
 * actor appears" is a claim with two ways to fail rather than one.
 * @param {object} org
 */
async function seedBusyLog(org) {
  await appendMany(org, {
    actor: org.member,
    count: MEMBER_EVENTS,
    action: AUDIT_ACTION.REQUEST_SUBMITTED,
    targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
    targetId: org.request._id,
  });
  await appendMany(org, {
    actor: org.admin,
    count: OTHER_EVENTS / 2,
    action: AUDIT_ACTION.ASSET_UPDATED,
    targetType: AUDIT_TARGET_TYPE.Asset,
    targetId: org.asset._id,
  });
  await appendMany(org, {
    actor: org.approver,
    count: OTHER_EVENTS / 2,
    action: AUDIT_ACTION.REQUEST_APPROVED,
    targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
    targetId: org.checkedOutRequest._id,
  });
}

describe('AT-1 — filters narrow results exactly (SCRUM-46)', () => {
  beforeEach(async () => {
    await seedBusyLog(seed.a);
  });

  it('returns exactly the entries made by the filtered actor, and no others', async () => {
    const res = await auditAs(seed.a.admin, `?actorId=${seed.a.member._id}&limit=100`);

    expect(res.status).toBe(200);
    // The displayed result count, which is what the admin reads off the screen.
    expect(res.body.total).toBe(MEMBER_EVENTS);
    expect(res.body.items).toHaveLength(MEMBER_EVENTS);
    // Every row, not just the first: a filter that leaked one entry in forty would pass a
    // spot-check on items[0] and still be wrong.
    const actors = new Set(res.body.items.map((e) => e.actorId));
    expect([...actors]).toEqual([String(seed.a.member._id)]);
  });

  it('still returns exactly those entries when a date range is combined with the actor', async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    const res = await auditAs(
      seed.a.admin,
      `?actorId=${seed.a.member._id}&from=${from}&to=${to}&limit=100`,
    );

    expect(res.body.total).toBe(MEMBER_EVENTS);
    expect(res.body.items).toHaveLength(MEMBER_EVENTS);
  });

  it('excludes entries that fall outside the date range', async () => {
    // Every row was stamped by the server a moment ago, so a window that closes a minute ago
    // contains none of them. This is the half of a range filter that silently passes when the
    // range is ignored altogether.
    const to = new Date(Date.now() - 60_000).toISOString();

    const res = await auditAs(seed.a.admin, `?to=${to}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, items: [] });
  });

  it('narrows by action, independently of who performed it', async () => {
    const res = await auditAs(seed.a.admin, `?action=${AUDIT_ACTION.REQUEST_APPROVED}&limit=100`);

    expect(res.body.total).toBe(OTHER_EVENTS / 2);
    const actions = new Set(res.body.items.map((e) => e.action));
    expect([...actions]).toEqual([AUDIT_ACTION.REQUEST_APPROVED]);
  });

  it('reports the true total across pages rather than the size of the page', async () => {
    const first = await auditAs(seed.a.admin, `?actorId=${seed.a.member._id}&limit=25`);
    const second = await auditAs(seed.a.admin, `?actorId=${seed.a.member._id}&limit=25&page=2`);

    expect(first.body).toMatchObject({ total: MEMBER_EVENTS, page: 1, limit: 25 });
    expect(first.body.items).toHaveLength(25);
    expect(second.body.items).toHaveLength(MEMBER_EVENTS - 25);
    // The pages must partition the result, not overlap it.
    const ids = [...first.body.items, ...second.body.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(MEMBER_EVENTS);
  });

  it('shows the whole organisation’s log when no filter is given', async () => {
    // The fixture's own ORG_CREATED row is part of the organisation's history, so the unfiltered
    // total is everything seeded here plus that one.
    const res = await auditAs(seed.a.admin, '?limit=1');
    expect(res.body.total).toBe(MEMBER_EVENTS + OTHER_EVENTS + 1);
  });

  it('never includes another organisation’s entries, even filtering by its actor', async () => {
    await seedBusyLog(seed.b);

    const unfiltered = await auditAs(seed.a.admin, '?limit=1');
    expect(unfiltered.body.total).toBe(MEMBER_EVENTS + OTHER_EVENTS + 1);

    // An actor id that is real, but belongs to the other tenant. `orgId` comes from the verified
    // token and is never taken from the request (SR-2), so this matches nothing rather than
    // reaching across (SCRUM-46: "my organization's audit log").
    const foreign = await auditAs(seed.a.admin, `?actorId=${seed.b.member._id}&limit=100`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toMatchObject({ total: 0, items: [] });
  });
});

describe('AT-2 — filter input cannot be used as a query operator (SCRUM-46, SR-6)', () => {
  beforeEach(async () => {
    await seedBusyLog(seed.a);
  });

  /** Assert a query was refused as a validation error carrying no audit data. */
  const expectRefused = (res) => {
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // The point of the criterion: no entries come back, not even a partial page.
    expect(res.body.items).toBeUndefined();
    expect(res.body.total).toBeUndefined();
  };

  it('refuses the actor filter submitted as an object, on every operator shape', async () => {
    // The story's exact vector, `{"$gt": ""}`, plus the two next-most-likely spellings. With the
    // `simple` query parser these arrive as flat unrecognised keys, and the strict schema refuses
    // them; the filter never reaches the repository.
    for (const query of ['?actorId[$gt]=', '?actorId[$ne]=x', '?actorId[$regex]=.*']) {
      const res = await auditAs(seed.a.admin, query);
      expectRefused(res);
      expect(res.body.error.details[0]).toMatchObject({
        location: 'query',
        message: expect.stringContaining('Unrecognized key'),
      });
    }
  });

  it('refuses an operator smuggled into the action filter too', async () => {
    // Not just the actor: the criterion is about filter input generally, and `action` is the filter
    // whose values are a known enum, which is exactly where a bypass would be most useful.
    const res = await auditAs(seed.a.admin, '?action[$ne]=ORG_CREATED');
    expectRefused(res);
  });

  it('refuses a parameter whose own name is an operator', async () => {
    // A different layer from the two above: `assertNoMongoOperators` refuses `$`-prefixed and
    // dotted keys before the schema is consulted at all.
    const res = await auditAs(seed.a.admin, '?$where=1');
    expectRefused(res);
    expect(res.body.error.details[0]).toMatchObject({
      path: '$where',
      message: expect.stringContaining('may not start with "$"'),
    });
  });

  it('refuses an actor filter that is a string but not an id', async () => {
    // The third layer: even a well-formed flat string has to be a real object id, so a value cannot
    // be smuggled through as a serialised operator.
    const res = await auditAs(seed.a.admin, '?actorId={"$gt":""}');
    expectRefused(res);
    expect(res.body.error.details[0]).toMatchObject({
      path: 'actorId',
      message: expect.stringContaining('24-character hex id'),
    });
  });

  it('refuses unknown query parameters instead of ignoring them', async () => {
    // A dropped filter is worse than a rejected one: it returns more rows than the caller believes
    // they asked for, and an investigator would not notice.
    const res = await auditAs(seed.a.admin, '?actorID=abc');
    expectRefused(res);
  });

  it('leaves the log exactly as it was after every rejected attempt', async () => {
    const before = await auditAs(seed.a.admin, '?limit=1');

    for (const query of ['?actorId[$gt]=', '?$where=1', '?actorId={"$gt":""}', '?action[$ne]=x']) {
      await auditAs(seed.a.admin, query);
    }

    const after = await auditAs(seed.a.admin, '?limit=1');
    expect(after.body.total).toBe(before.body.total);
  });
});

describe('AT-3 — members cannot read the organization-wide log (SCRUM-46)', () => {
  beforeEach(async () => {
    await seedBusyLog(seed.a);
  });

  it('refuses a member with 403 and returns no audit entries', async () => {
    const res = await auditAs(seed.a.member, '');

    expect(res.status).toBe(403);
    expect(res.body.items).toBeUndefined();
    // Not even the count, which would leak how much activity the organisation has.
    expect(res.body.total).toBeUndefined();
  });

  it('refuses a member who tries to read only their own entries', async () => {
    // `audit:read` is a permission to read the trail, not a permission to read the trail about
    // yourself — a member filtering to their own id is still refused.
    const res = await auditAs(seed.a.member, `?actorId=${seed.a.member._id}`);
    expect(res.status).toBe(403);
  });

  it('refuses an approver — audit:read is ORG_ADMIN only', async () => {
    const res = await auditAs(seed.a.approver, '');
    expect(res.status).toBe(403);
    expect(res.body.items).toBeUndefined();
  });

  it('refuses a request with no session at all', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
    expect(res.body.items).toBeUndefined();
  });

  it('allows the organisation’s own admin', async () => {
    // The counterpart the three refusals above are only meaningful against: the endpoint does work,
    // for exactly one role.
    const res = await auditAs(seed.a.admin, '?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

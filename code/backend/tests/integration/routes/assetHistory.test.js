/**
 * Integration tests for `GET /api/assets/:id/history` (SCRUM-29, user story 3).
 *
 * The three acceptance tests from the story map onto the three describes below: AT-1 that the history
 * is complete and correctly ordered, AT-2 that it does not cross tenant boundaries, AT-3 that it
 * cannot be altered.
 *
 * **"Complete" is the part worth stating plainly.** An asset's events are not all recorded against
 * the asset: creation and edits are, but a checkout is recorded against the physical *unit* and a
 * submission or approval against the *request*. A history that read only the asset's own rows would
 * return the creation and none of the borrowing — it would look like a working feature while omitting
 * exactly what a chain of custody is for. `gathers events recorded against the asset, its units and
 * its requests` is therefore the test that proves the feature rather than its plumbing.
 *
 * Events are appended in sequence rather than backdated, because `AuditEvent` re-stamps `timestamp`
 * on every insert path (SR-8) — an audit row cannot be placed at a time of the caller's choosing,
 * not even by a test. So insertion order is chronological order here, and "newest first" means the
 * reverse of the order these tests append in.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';
import { ROLES } from '../../../src/utils/permissions.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

/** The history endpoint for one asset, as the given seeded user. */
const historyAs = (user, assetId, query = '') =>
  request(app).get(`/api/assets/${assetId}/history${query}`).set('Cookie', accessCookieFor(user));

/**
 * Append one audit event, awaited so that append order is timestamp order.
 *
 * Sequential on purpose: `Promise.all` over these would leave the order of equal timestamps to the
 * database, and these tests assert on ordering.
 * @param {object} org one half of the `seedTwoOrgs` fixture
 * @param {{ action: string, targetType: string, targetId: unknown, actor?: object }} event
 * @returns {Promise<object>}
 */
const append = (org, { action, targetType, targetId, actor = org.admin }) =>
  auditRepo.append(org.orgId, {
    actorId: actor._id,
    actorRole: actor.role,
    action,
    targetType,
    targetId,
  });

describe('AT-1 — history is complete and correctly ordered (SCRUM-29)', () => {
  it('gathers events recorded against the asset, its units and its requests', async () => {
    const org = seed.a;
    // The borrowing loop as the application actually records it: the request carries the submission
    // and the decision, the unit carries the handover and the return, the asset carries its own
    // creation. Three target types, one story.
    await append(org, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: org.asset._id,
    });
    await append(org, {
      action: AUDIT_ACTION.REQUEST_SUBMITTED,
      targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
      targetId: org.checkedOutRequest._id,
      actor: org.member,
    });
    await append(org, {
      action: AUDIT_ACTION.REQUEST_APPROVED,
      targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
      targetId: org.checkedOutRequest._id,
      actor: org.approver,
    });
    await append(org, {
      action: AUDIT_ACTION.ASSET_CHECKED_OUT,
      targetType: AUDIT_TARGET_TYPE.AssetUnit,
      targetId: org.units[1]._id,
      actor: org.approver,
    });
    await append(org, {
      action: AUDIT_ACTION.ASSET_RETURNED,
      targetType: AUDIT_TARGET_TYPE.AssetUnit,
      targetId: org.units[1]._id,
      actor: org.approver,
    });

    const res = await historyAs(org.admin, org.asset._id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    // Newest first, so the reverse of the order they were appended in.
    expect(res.body.items.map((e) => e.action)).toEqual([
      AUDIT_ACTION.ASSET_RETURNED,
      AUDIT_ACTION.ASSET_CHECKED_OUT,
      AUDIT_ACTION.REQUEST_APPROVED,
      AUDIT_ACTION.REQUEST_SUBMITTED,
      AUDIT_ACTION.ASSET_CREATED,
    ]);
  });

  it('shows each actor’s display name, the action, and the timestamp', async () => {
    const org = seed.a;
    await append(org, {
      action: AUDIT_ACTION.REQUEST_SUBMITTED,
      targetType: AUDIT_TARGET_TYPE.CheckoutRequest,
      targetId: org.checkedOutRequest._id,
      actor: org.member,
    });

    const res = await historyAs(org.admin, org.asset._id);
    const [event] = res.body.items;
    expect(event.actor).toMatchObject({
      id: String(org.member._id),
      name: org.member.name,
      // The role the actor held *at the time*, stored on the row — not looked up now, so a later
      // promotion cannot rewrite the authority someone acted with.
      role: ROLES.MEMBER,
    });
    expect(event.action).toBe(AUDIT_ACTION.REQUEST_SUBMITTED);
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  });

  it('names the unit an event concerned, so a row reads without the unit list', async () => {
    const org = seed.a;
    await append(org, {
      action: AUDIT_ACTION.ASSET_CHECKED_OUT,
      targetType: AUDIT_TARGET_TYPE.AssetUnit,
      targetId: org.units[1]._id,
    });

    const res = await historyAs(org.admin, org.asset._id);
    expect(res.body.items[0].unitTag).toBe(org.units[1].tag);
  });

  it('leaves out another asset’s events, including its units’', async () => {
    const org = seed.a;
    const [{ asset: camera, units: cameraUnits }] = org.extraAssets;
    await append(org, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: camera._id,
    });
    await append(org, {
      action: AUDIT_ACTION.ASSET_CHECKED_OUT,
      targetType: AUDIT_TARGET_TYPE.AssetUnit,
      targetId: cameraUnits[0]._id,
    });
    await append(org, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: org.asset._id,
    });

    const res = await historyAs(org.admin, org.asset._id);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].targetId).toBe(String(org.asset._id));
  });

  it('answers an empty history with an empty list rather than an error', async () => {
    // Nothing has been recorded against this asset, and `$or: []` is a query MongoDB rejects — so
    // "nothing happened yet" has to be an ordinary empty page, not a 500.
    const res = await historyAs(seed.a.admin, seed.a.extraAssets[1].asset._id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, items: [] });
  });

  it('paginates, and the pages do not overlap', async () => {
    const org = seed.a;
    for (let i = 0; i < 5; i += 1) {
      await append(org, {
        action: AUDIT_ACTION.ASSET_UPDATED,
        targetType: AUDIT_TARGET_TYPE.Asset,
        targetId: org.asset._id,
      });
    }

    const first = await historyAs(org.admin, org.asset._id, '?limit=2');
    const second = await historyAs(org.admin, org.asset._id, '?limit=2&page=2');
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(2);
    const ids = [...first.body.items, ...second.body.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('carries the asset it belongs to, so the screen can title itself', async () => {
    const res = await historyAs(seed.a.admin, seed.a.asset._id);
    expect(res.body.asset).toMatchObject({
      id: String(seed.a.asset._id),
      name: seed.a.asset.name,
    });
  });
});

describe('AT-2 — history does not cross tenant boundaries (SCRUM-29, SR-2)', () => {
  it('answers 404, not 403, for another organisation’s asset and returns no history', async () => {
    // The distinction is the test. A 403 would confirm that org B's asset id is a real asset
    // somewhere, which is the existence leak SR-2 prohibits; a 404 says only "not here".
    const res = await historyAs(seed.a.admin, seed.b.asset._id);
    expect(res.status).toBe(404);
    expect(res.body.items).toBeUndefined();
  });

  it('answers a cross-tenant id exactly as it answers one that never existed', async () => {
    const foreign = await historyAs(seed.a.admin, seed.b.asset._id);
    const missing = await historyAs(seed.a.admin, '0'.repeat(24));
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body.error?.code).toBe(missing.body.error?.code);
  });

  it('never returns another organisation’s events for an id that exists in both', async () => {
    // Both organisations record against their own asset. Org A must see only its own row, even
    // though the two are the same kind of event appended at the same moment.
    await append(seed.b, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: seed.b.asset._id,
    });
    await append(seed.a, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: seed.a.asset._id,
    });

    const res = await historyAs(seed.a.admin, seed.a.asset._id);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].targetId).toBe(String(seed.a.asset._id));
  });

  it('is refused to a member and an approver — audit:read is ORG_ADMIN only', async () => {
    for (const role of ['member', 'approver']) {
      const res = await historyAs(seed.a[role], seed.a.asset._id);
      expect(res.status).toBe(403);
      expect(res.body.items).toBeUndefined();
    }
  });

  it('is refused without a session at all', async () => {
    const res = await request(app).get(`/api/assets/${seed.a.asset._id}/history`);
    expect(res.status).toBe(401);
  });
});

describe('AT-3 — history cannot be altered (SCRUM-29, SR-8)', () => {
  it('offers no way to change or remove an entry, and the entry survives the attempt', async () => {
    const org = seed.a;
    await append(org, {
      action: AUDIT_ACTION.ASSET_CREATED,
      targetType: AUDIT_TARGET_TYPE.Asset,
      targetId: org.asset._id,
    });
    const before = await historyAs(org.admin, org.asset._id);
    const entryId = before.body.items[0].id;

    // Every shape an admin might reach for. None of them is a route, which is the design: the API
    // exposes append and read, so there is nothing to authorise and nothing to refuse.
    const attempts = await Promise.all([
      request(app)
        .patch(`/api/audit/${entryId}`)
        .set('Cookie', accessCookieFor(org.admin))
        .send({ action: AUDIT_ACTION.ASSET_RETURNED }),
      request(app).delete(`/api/audit/${entryId}`).set('Cookie', accessCookieFor(org.admin)),
      request(app)
        .patch(`/api/assets/${org.asset._id}/history`)
        .set('Cookie', accessCookieFor(org.admin))
        .send({ action: AUDIT_ACTION.ASSET_RETURNED }),
      request(app)
        .delete(`/api/assets/${org.asset._id}/history`)
        .set('Cookie', accessCookieFor(org.admin)),
    ]);
    for (const res of attempts) {
      expect(res.status).not.toBe(200);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }

    const after = await historyAs(org.admin, org.asset._id);
    expect(after.body.total).toBe(before.body.total);
    expect(after.body.items[0]).toMatchObject({
      id: entryId,
      action: AUDIT_ACTION.ASSET_CREATED,
      timestamp: before.body.items[0].timestamp,
    });
  });

  it('exposes only append and query at the data layer, so no caller can reach a mutation', async () => {
    // The backstop for the route test above: routes come and go, but a repository with no update
    // and no delete in it cannot grow one by accident in a later ticket.
    expect(Object.keys(auditRepo).sort()).toEqual(['append', 'query']);
  });
});

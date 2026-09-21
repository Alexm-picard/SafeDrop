// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: GET /api/assets and GET /api/assets/:id — pagination, includeRetired, and the cross-tenant 404 (SR-2)
// Human Contributions: reviewed by Orelmis Toribio (PR #14, 2026-09-19)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Integration tests for `GET /api/assets` and `GET /api/assets/:id` (SCRUM-115).
 *
 * The fixture (`seedTwoOrgs`) gives each organisation three assets — Laptop, Camera, Projector — with
 * no asset itself retired, so the retirement tests here retire one explicitly. The cross-tenant test
 * is the one that matters most: reading org B's asset id as org A must come back 404, never 403,
 * because a 403 would confirm the id exists somewhere (SR-2).
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetRepo from '../../../src/repositories/asset.repository.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

describe('GET /api/assets (SCRUM-115)', () => {
  it('lists the caller org’s assets, paginated, and never another org’s', async () => {
    const res = await request(app).get('/api/assets').set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 25 });
    expect(res.body.items).toHaveLength(3);
    const names = res.body.items.map((a) => a.name).sort();
    expect(names).toEqual(['Camera A', 'Laptop a', 'Projector A']);
    // Every item carries an `id` (never `_id`) and belongs to the caller's org.
    expect(res.body.items.every((a) => typeof a.id === 'string')).toBe(true);
    expect(res.body.items.some((a) => a.name.includes(' B'))).toBe(false);
  });

  it('every role can browse the catalogue (assets:read is universal)', async () => {
    for (const role of ['member', 'approver', 'admin']) {
      const res = await request(app)
        .get('/api/assets')
        .set('Cookie', accessCookieFor(seed.a[role]));
      expect(res.status).toBe(200);
    }
  });

  it('hides a retired asset unless includeRetired=true', async () => {
    await assetRepo.retire(seed.a.orgId, seed.a.asset._id);

    const hidden = await request(app)
      .get('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(hidden.body.total).toBe(2);
    expect(hidden.body.items.some((a) => a.id === String(seed.a.asset._id))).toBe(false);

    const shown = await request(app)
      .get('/api/assets?includeRetired=true')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(shown.body.total).toBe(3);
    expect(shown.body.items.some((a) => a.id === String(seed.a.asset._id))).toBe(true);
  });

  it('narrows by category', async () => {
    const res = await request(app)
      .get('/api/assets?category=camera')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe('Camera A');
  });

  it('paginates with page and limit', async () => {
    const res = await request(app)
      .get('/api/assets?limit=2&page=2')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(res.body.items).toHaveLength(1);
  });

  it('rejects a caller with no session', async () => {
    const res = await request(app).get('/api/assets');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/assets/:id (SCRUM-115)', () => {
  it('returns the asset with its units', async () => {
    const res = await request(app)
      .get(`/api/assets/${seed.a.asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: String(seed.a.asset._id), name: 'Laptop a' });
    expect(res.body.units).toHaveLength(3);
    const byTag = Object.fromEntries(res.body.units.map((u) => [u.tag, u.status]));
    expect(byTag).toMatchObject({ 'a-001': 'REQUESTED', 'a-002': 'OUT', 'a-003': 'HELD' });
    expect(res.body.units.every((u) => typeof u.id === 'string')).toBe(true);
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await request(app)
      .get(`/api/assets/${'0'.repeat(24)}`)
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404, never 403, for an id belonging to another organisation (SR-2)', async () => {
    const res = await request(app)
      .get(`/api/assets/${seed.b.asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id with 400 before it ever reaches the service', async () => {
    const res = await request(app)
      .get('/api/assets/not-an-object-id')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

/**
 * The write path (SCRUM-134).
 *
 * Four endpoints, one shape: resolve by (orgId, id) → 404 if absent → write the change and its audit
 * event in one transaction. The tests below check three things for each — that it writes what it
 * should, that exactly one audit event lands with it, and that another organisation's id is a 404
 * rather than a 403.
 *
 * The two conflict cases carry the most weight, because both are the kind of rule that is easy to
 * implement as a racy read-then-write: retiring an asset whose unit is still out, and reusing a tag.
 */
describe('POST /api/assets (SCRUM-134)', () => {
  it('creates an asset in the caller’s org and appends ASSET_CREATED', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'Tripod', category: 'tripod', description: 'Carbon', imageUrl: null });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Tripod', category: 'tripod', retiredAt: null });
    expect(res.body.id).toEqual(expect.any(String));
    // The frontend navigates to the new asset by this id, so its absence would be a broken redirect.
    expect(res.body).not.toHaveProperty('_id');
    // Stamped with the caller's own org, which was never in the body.
    expect(String(res.body.orgId)).toBe(String(seed.a.orgId));

    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_CREATED' });
    expect(events.total).toBe(1);
    expect(String(events.items[0].targetId)).toBe(res.body.id);
    expect(events.items[0].after).toMatchObject({ name: 'Tripod' });
    expect(String(events.items[0].actorId)).toBe(String(seed.a.admin._id));
  });

  it('ignores an orgId smuggled in the body rather than trusting it', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'Mic', category: 'audio', orgId: String(seed.b.orgId) });

    // `strict` schemas reject unknown fields outright, which is the stronger answer than silently
    // dropping them — either way the asset cannot land in org B.
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(String(res.body.orgId)).toBe(String(seed.a.orgId));
    }
    const inB = await request(app).get('/api/assets').set('Cookie', accessCookieFor(seed.b.admin));
    expect(inB.body.items.some((a) => a.name === 'Mic')).toBe(false);
  });

  it.each(['member', 'approver'])('refuses %s: assets:write is ORG_ADMIN only', async (role) => {
    const res = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a[role]))
      .send({ name: 'Nope', category: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/assets/:id (SCRUM-134)', () => {
  it('applies a partial update and records before/after for the changed field only', async () => {
    const res = await request(app)
      .patch(`/api/assets/${seed.a.asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'Laptop renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Laptop renamed');
    // Untouched fields keep their values.
    expect(res.body.category).toBe(seed.a.asset.category);

    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_UPDATED' });
    expect(events.total).toBe(1);
    expect(events.items[0].before).toEqual({ name: 'Laptop a' });
    expect(events.items[0].after).toEqual({ name: 'Laptop renamed' });
    // The snapshot names what changed rather than copying the whole document.
    expect(Object.keys(events.items[0].after)).toEqual(['name']);
  });

  it('answers 404, never 403, for another organisation’s asset (SR-2)', async () => {
    const res = await request(app)
      .patch(`/api/assets/${seed.b.asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'Reached across the boundary' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // And nothing was written on the other side.
    const untouched = await assetRepo.findById(seed.b.orgId, seed.b.asset._id);
    expect(untouched.name).toBe(seed.b.asset.name);
    const events = await auditRepo.query(seed.b.orgId, { action: 'ASSET_UPDATED' });
    expect(events.total).toBe(0);
  });

  it('records nothing when the patch changes nothing', async () => {
    const res = await request(app)
      .patch(`/api/assets/${seed.a.asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(res.status).toBe(200);
    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_UPDATED' });
    expect(events.total).toBe(0);
  });
});

describe('POST /api/assets/:id/retire (SCRUM-134)', () => {
  /** The camera's units are AVAILABLE, AVAILABLE and RETIRED — nothing blocking. */
  const retirableAsset = (org) => org.extraAssets[0].asset;

  it('stamps retiredAt, keeps the units, and appends ASSET_RETIRED', async () => {
    const asset = retirableAsset(seed.a);
    const res = await request(app)
      .post(`/api/assets/${asset._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.retiredAt).toEqual(expect.any(String));

    // A soft delete: the units are still there, which is what keeps history resolvable.
    const units = await assetUnitRepo.listByAsset(seed.a.orgId, asset._id);
    expect(units).toHaveLength(3);

    // And it drops out of the catalogue unless asked for.
    const listed = await request(app)
      .get('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.member));
    expect(listed.body.items.some((a) => a.id === String(asset._id))).toBe(false);

    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_RETIRED' });
    expect(events.total).toBe(1);
    expect(events.items[0].before).toEqual({ retiredAt: null });
    expect(events.items[0].after.retiredAt).toBeTruthy();
  });

  it('refuses with 409 while a unit is OUT or HELD, and writes nothing', async () => {
    // The laptop's units are REQUESTED, OUT and HELD.
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The admin screen shows this verbatim, so it has to name the reason.
    expect(res.body.error.message).toMatch(/checked out, held, or requested/i);

    const unchanged = await assetRepo.findById(seed.a.orgId, seed.a.asset._id);
    expect(unchanged.retiredAt).toBeNull();
    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_RETIRED' });
    expect(events.total).toBe(0);
  });

  it('refuses with 409 while a unit is REQUESTED, and writes nothing', async () => {
    const asset = retirableAsset(seed.a);
    const submitRes = await request(app)
      .post('/api/requests')
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({
        unitId: seed.a.extraAssets[0].units[0]._id,
        neededFrom: '2026-11-01T00:00:00.000Z',
        neededTo: '2026-11-05T00:00:00.000Z',
      });
    expect(submitRes.status).toBe(201);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const unchanged = await assetRepo.findById(seed.a.orgId, asset._id);
    expect(unchanged.retiredAt).toBeNull();
  });

  it('refuses to retire twice rather than moving the date', async () => {
    const asset = retirableAsset(seed.a);
    const first = await request(app)
      .post(`/api/assets/${asset._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/assets/${asset._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(second.status).toBe(409);

    // The original retirement date survived, so the trail still says when it left circulation.
    const stored = await assetRepo.findById(seed.a.orgId, asset._id);
    expect(stored.retiredAt.toISOString()).toBe(new Date(first.body.retiredAt).toISOString());
    const events = await auditRepo.query(seed.a.orgId, { action: 'ASSET_RETIRED' });
    expect(events.total).toBe(1);
  });

  it('answers 404, never 403, for another organisation’s asset (SR-2)', async () => {
    const res = await request(app)
      .post(`/api/assets/${retirableAsset(seed.b)._id}/retire`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/assets/:id/units (SCRUM-134)', () => {
  it('adds a unit the server marks AVAILABLE and appends an audit event', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/units`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ tag: 'a-004', serial: 'SN-4', condition: 'FAIR' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tag: 'a-004', serial: 'SN-4', condition: 'FAIR' });
    // Status is assigned by the server, not the client.
    expect(res.body.status).toBe('AVAILABLE');
    expect(String(res.body.assetId)).toBe(String(seed.a.asset._id));

    const events = await auditRepo.query(seed.a.orgId, { targetType: 'AssetUnit' });
    expect(events.total).toBe(1);
    expect(String(events.items[0].targetId)).toBe(res.body.id);
  });

  it('will not let the client choose the status', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/units`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ tag: 'a-005', status: 'OUT' });

    // `unitBody` has no `status`, so a strict schema rejects it; if it were ever relaxed, the
    // service still overrides it. Either answer keeps a unit from being born checked out.
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.status).toBe('AVAILABLE');
    }
  });

  it('rejects a duplicate tag with 409 naming the tag field', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/units`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      // Already used by the seeded unit on this same asset.
      .send({ tag: 'a-001' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The admin screen reads details.field to put the message under the tag input rather than in a
    // page-level banner, so this shape is part of the contract.
    expect(res.body.error.details).toMatchObject({ field: 'tag' });

    const events = await auditRepo.query(seed.a.orgId, { targetType: 'AssetUnit' });
    expect(events.total).toBe(0);
  });

  it('rejects a tag already used elsewhere in the same org, on a different asset', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.extraAssets[0].asset._id}/units`)
      // 'a-001' belongs to the laptop, but uniqueness is per organisation, not per asset.
      .send({ tag: 'a-001' })
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.status).toBe(409);
  });

  it('allows the same tag in a different organisation', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.b.asset._id}/units`)
      // Org A uses 'a-001'; org B may too, since the index is (orgId, tag).
      .send({ tag: 'a-001' })
      .set('Cookie', accessCookieFor(seed.b.admin));
    expect(res.status).toBe(201);
  });

  it('answers 404, never 403, for another organisation’s asset (SR-2)', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.b.asset._id}/units`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ tag: 'smuggled-001' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const units = await assetUnitRepo.listByAsset(seed.b.orgId, seed.b.asset._id);
    expect(units.some((u) => u.tag === 'smuggled-001')).toBe(false);
  });
});

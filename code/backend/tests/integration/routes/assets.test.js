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
    expect(byTag).toMatchObject({ 'a-001': 'AVAILABLE', 'a-002': 'OUT', 'a-003': 'HELD' });
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

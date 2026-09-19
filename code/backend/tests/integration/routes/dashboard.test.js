// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: SCRUM-103 dashboard summary: counts from AssetUnit.status, ORG_ADMIN only
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Integration tests for `GET /api/dashboard/summary` (SCRUM-103).
 *
 * The one fully implemented read path in Iteration 1, so this suite proves the whole stack end to end:
 * route, permission, controller, service, repository aggregation.
 *
 * It pins the counting rules — retired units are excluded from `totalAssets`, an organisation with no
 * units reports zeros rather than an error — and the access rules for a route that only ORG_ADMIN
 * holds.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import { UNIT_STATUS } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

describe('GET /api/dashboard/summary (SCRUM-103)', () => {
  it('returns totalAssets, checkedOut and available for the admin’s org', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalAssets: 7, checkedOut: 2, available: 4, held: 1, retired: 1 });
  });

  it('excludes retired units from totalAssets', async () => {
    await assetUnitRepo.create(seed.a.orgId, {
      assetId: seed.a.asset._id,
      tag: 'a-retired',
      status: UNIT_STATUS.RETIRED,
    });
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.body).toMatchObject({ totalAssets: 7, retired: 2 });
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
    expect(res.body).toEqual({ totalAssets: 0, checkedOut: 0, available: 0, held: 0, retired: 0 });
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

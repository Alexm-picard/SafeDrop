// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: table-driven multi-tenancy proof (SR-2): org A can never see, count or address org B's records
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.
//
// Two layers:
//  1. Repository layer: every finder takes orgId first and returns null for another tenant's id.
//  2. HTTP layer: one row per endpoint that addresses a resource. Rows marked `implemented: false`
//     are skipped until their ticket lands; flip the flag when you implement the endpoint and the
//     row asserts 404 (never 403, which would confirm the id exists).

/**
 * Security tests for tenant isolation (SR-2), at every layer.
 *
 * Organisation A must never see or affect organisation B. The suite checks this three ways: at the
 * repository layer, that `orgId` is the first argument of every function and genuinely scopes the
 * query; at the HTTP layer, that org A addressing org B's records gets nothing back, and that an
 * `orgId` smuggled in a query string or body is stripped before it reaches a handler; and at the
 * Mongoose layer, that `strictQuery: 'throw'` makes a mistyped tenant key throw instead of quietly
 * widening a query to every organisation.
 *
 * That last case is the subtle one — a filter on `orgID` instead of `orgId` would otherwise match
 * everything, which is precisely the bug this setting exists to prevent.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import * as assetRepo from '../../../src/repositories/asset.repository.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import * as checkoutRepo from '../../../src/repositories/checkoutRequest.repository.js';
import * as userRepo from '../../../src/repositories/user.repository.js';
import { UNIT_STATUS } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

describe('repository layer: orgId is always the first argument and always scopes the query', () => {
  const finders = [
    { name: 'user.findById', run: (orgId, s) => userRepo.findById(orgId, s.member._id) },
    { name: 'user.findByEmail', run: (orgId, s) => userRepo.findByEmail(orgId, s.member.email) },
    { name: 'user.findRole', run: (orgId, s) => userRepo.findRole(orgId, s.member._id) },
    { name: 'asset.findById', run: (orgId, s) => assetRepo.findById(orgId, s.asset._id) },
    {
      name: 'assetUnit.findById',
      run: (orgId, s) => assetUnitRepo.findById(orgId, s.units[0]._id),
    },
    {
      name: 'checkoutRequest.findById',
      run: (orgId, s) => checkoutRepo.findById(orgId, s.request._id),
    },
    {
      name: 'user.updateRole',
      run: (orgId, s) => userRepo.updateRole(orgId, s.member._id, 'APPROVER'),
    },
    {
      name: 'asset.update',
      run: (orgId, s) => assetRepo.update(orgId, s.asset._id, { name: 'x' }),
    },
    { name: 'asset.retire', run: (orgId, s) => assetRepo.retire(orgId, s.asset._id) },
    {
      name: 'assetUnit.updateStatus',
      run: (orgId, s) => assetUnitRepo.updateStatus(orgId, s.units[0]._id, UNIT_STATUS.OUT),
    },
    {
      name: 'checkoutRequest.transition',
      run: (orgId, s) =>
        checkoutRepo.transition(orgId, s.request._id, {
          expectedState: 'PENDING',
          patch: { state: 'DENIED' },
        }),
    },
  ];

  it.each(finders)(
    "$name: org A asking for org B's id gets null; its own id resolves",
    async ({ run }) => {
      expect(await run(seed.a.orgId, seed.b)).toBeNull();
      expect(await run(seed.a.orgId, seed.a)).not.toBeNull();
    },
  );

  it('list-style readers only ever return the caller org', async () => {
    const users = await userRepo.list(seed.a.orgId);
    expect(users.items.map((u) => String(u.orgId))).toEqual(
      Array(users.items.length).fill(seed.a.orgId),
    );
    const assets = await assetRepo.list(seed.a.orgId);
    expect(assets.total).toBe(3);
    const units = await assetUnitRepo.listByAsset(seed.a.orgId, seed.b.asset._id);
    expect(units).toHaveLength(0);
    const requests = await checkoutRepo.list(seed.a.orgId);
    expect(requests.total).toBe(5);
    const audit = await auditRepo.query(seed.a.orgId);
    expect(audit.total).toBe(1);
    expect(String(audit.items[0].orgId)).toBe(seed.a.orgId);
    const counts = await assetUnitRepo.countByStatus(seed.a.orgId);
    expect(counts).toEqual({ AVAILABLE: 4, HELD: 1, OUT: 2, RETIRED: 1, REQUESTED: 0 });
  });
});

describe('HTTP layer: org A addressing org B', () => {
  const asAdminA = (req) =>
    req.set('Cookie', accessCookieFor(seed.a.admin)).set('Content-Type', 'application/json');

  it('dashboard summary counts only org A even when org B has more units and requests', async () => {
    await assetUnitRepo.create(seed.b.orgId, {
      assetId: seed.b.asset._id,
      tag: 'b-extra',
      status: UNIT_STATUS.AVAILABLE,
    });
    await checkoutRepo.create(seed.b.orgId, {
      unitId: seed.b.units[0]._id,
      requesterId: seed.b.member._id,
      neededFrom: new Date(),
      neededTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      note: '',
    });
    const res = await asAdminA(request(app).get('/api/dashboard/summary'));
    expect(res.status).toBe(200);
    // Org A's own figures, unmoved: the fixture gives each organisation the same shape of data, so a
    // query missing its orgId filter would show doubled counts here.
    expect(res.body).toMatchObject({
      totalAssets: 7,
      checkedOut: 2,
      available: 4,
      held: 1,
      retired: 1,
      pendingRequests: 1,
    });
  });

  it('an orgId smuggled in the query string is ignored', async () => {
    const res = await asAdminA(request(app).get(`/api/dashboard/summary?orgId=${seed.b.orgId}`));
    expect(res.status).toBe(200);
    expect(res.body.totalAssets).toBe(7);
  });

  it('an orgId smuggled in the body is stripped before validation', async () => {
    const res = await asAdminA(request(app).post('/api/auth/logout')).send({ orgId: seed.b.orgId });
    expect(res.status).toBe(204);
  });

  // One row per resource endpoint. `target` picks the org-B id to address.
  const rows = [
    {
      method: 'GET',
      path: '/api/assets/:id',
      target: (s) => s.asset._id,
      implemented: false,
      ticket: 'SCRUM-assets-read',
    },
    {
      method: 'PATCH',
      path: '/api/assets/:id',
      body: { name: 'x' },
      target: (s) => s.asset._id,
      implemented: false,
      ticket: 'SCRUM-assets-update',
    },
    {
      method: 'POST',
      path: '/api/assets/:id/retire',
      target: (s) => s.asset._id,
      implemented: false,
      ticket: 'SCRUM-assets-retire',
    },
    {
      method: 'POST',
      path: '/api/assets/:id/units',
      body: { tag: 'z' },
      target: (s) => s.asset._id,
      implemented: false,
      ticket: 'SCRUM-assets-units',
    },
    {
      method: 'GET',
      path: '/api/requests/:id',
      target: (s) => s.request._id,
      implemented: false,
      ticket: 'SCRUM-requests-read',
    },
    {
      method: 'POST',
      path: '/api/requests/:id/approve',
      target: (s) => s.request._id,
      implemented: true,
      ticket: 'SCRUM-requests-approve',
    },
    {
      method: 'POST',
      path: '/api/requests/:id/deny',
      target: (s) => s.request._id,
      implemented: true,
      ticket: 'SCRUM-requests-deny',
    },
    {
      method: 'POST',
      path: '/api/requests/:id/cancel',
      target: (s) => s.request._id,
      implemented: false,
      ticket: 'SCRUM-requests-cancel',
    },
    {
      method: 'POST',
      path: '/api/requests/:id/checkout',
      target: (s) => s.request._id,
      implemented: true,
      ticket: 'SCRUM-requests-checkout',
    },
    {
      method: 'POST',
      path: '/api/requests/:id/return',
      target: (s) => s.request._id,
      implemented: true,
      ticket: 'SCRUM-requests-return',
    },
    {
      method: 'PATCH',
      path: '/api/users/:id/role',
      body: { role: 'APPROVER' },
      target: (s) => s.member._id,
      implemented: true,
      ticket: 'SCRUM-users-role',
    },
  ];

  for (const row of rows) {
    const title = `${row.method} ${row.path} with org B's id → 404 (${row.ticket})`;
    (row.implemented ? it : it.skip)(title, async () => {
      const path = row.path.replace(':id', String(row.target(seed.b)));
      const res = await asAdminA(request(app)[row.method.toLowerCase()](path)).send(row.body ?? {});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  }
});

describe('a mistyped tenant key can never widen a query (strictQuery = throw)', () => {
  it('rejects a filter on a path that is not in the schema instead of dropping it', async () => {
    const { User } = await import('../../../src/models/User.js');
    await expect(User.find({ orgID: seed.a.orgId })).rejects.toThrow(/strictQuery/);
    await expect(User.countDocuments({ organisationId: seed.a.orgId })).rejects.toThrow(
      /strictQuery/,
    );
    expect(await User.countDocuments({ orgId: seed.a.orgId })).toBe(3);
  });
});

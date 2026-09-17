// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: deny-by-default proof (SDD §6.4): walks the live Express stack, exercises every route per role, and proves rogue registrations are refused at boot and at runtime (SR-1)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app, { createApp } from '../../../src/app.js';
import { denyByDefault } from '../../../src/middleware/authorize.js';
import { assetsRouter } from '../../../src/routes/assets.routes.js';
import {
  assertRoutesDeclarePermission,
  defineRoute,
  listRoutes,
} from '../../../src/routes/define.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PUBLIC_ROUTES,
  ROLE_LIST,
  roleHasPermission,
} from '../../../src/utils/permissions.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

const apiRoutes = listRoutes(app).filter((r) => r.path.startsWith('/api'));
const protectedRoutes = apiRoutes.filter((r) => !r.public);
const withId = (path) => path.replace(':id', new mongoose.Types.ObjectId().toString());
const send = (method, path) =>
  request(app)[method.toLowerCase()](path).set('Content-Type', 'application/json');

/** Register something rogue on the real assets router, run `fn`, then undo it. */
async function withRogue(register, fn) {
  const before = assetsRouter.stack.length;
  register(assetsRouter);
  try {
    await fn();
  } finally {
    assetsRouter.stack.length = before;
  }
}

describe('deny by default: every /api route declares a permission (SDD §6.4)', () => {
  it('registers the Iteration 1 API surface', () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(24);
  });

  it.each(apiRoutes)(
    '$method $path declares a known permission or is explicitly public',
    (route) => {
      if (route.public) {
        expect(route.permission).toBeNull();
      } else {
        expect(ALL_PERMISSIONS.has(route.permission)).toBe(true);
      }
      expect(route.regexp).toBeUndefined();
      expect(route.method).not.toBe('USE');
    },
  );

  it('exactly the three documented public routes skip authentication', () => {
    const actual = apiRoutes
      .filter((r) => r.public)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const expected = PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(actual).toEqual(expected);
  });

  it('the boot-time assertion rejects a route registered without defineRoute()', () => {
    const rogue = createApp();
    rogue.get('/api/rogue', (_req, res) => res.end());
    expect(() => assertRoutesDeclarePermission(rogue)).toThrow(/GET \/api\/rogue/);
    expect(() => assertRoutesDeclarePermission(app)).not.toThrow();
  });

  it('the boot-time assertion rejects a plain router.use() handler inside a resource router', async () => {
    await withRogue(
      (router) => router.use('/secret/deep', (_req, res) => res.json({ served: true })),
      () => expect(() => createApp()).toThrow(/USE \/api\/assets\/\*/),
    );
  });

  it('the boot-time assertion rejects a mounted sub-app and a RegExp path', async () => {
    await withRogue(
      (router) =>
        router.use(
          '/sub',
          express().get('/thing', (_req, res) => res.json({ served: true })),
        ),
      () => expect(() => createApp()).toThrow(/thing|USE/),
    );
    await withRogue(
      (router) => router.get(/^\/re-rogue$/, (_req, res) => res.json({ served: true })),
      () => expect(() => createApp()).toThrow(/regexp/),
    );
  });

  it('defineRoute refuses tenant ids in the URL and params without a schema', () => {
    const router = express.Router();
    expect(() =>
      defineRoute(
        router,
        { method: 'GET', path: '/:orgId/x', permission: PERMISSIONS.ASSETS_READ },
        () => {},
      ),
    ).toThrow(/tenant/);
    expect(() =>
      defineRoute(
        router,
        { method: 'GET', path: '/:id', permission: PERMISSIONS.ASSETS_READ },
        () => {},
      ),
    ).toThrow(/schemas.params/);
    expect(() => defineRoute(router, { method: 'GET', path: '/x' }, () => {})).toThrow(
      /permission/,
    );
    expect(() =>
      defineRoute(router, { method: 'GET', path: '/x', permission: 'nope:nope' }, () => {}),
    ).toThrow(/not a declared permission/);
  });
});

describe('runtime enforcement across every protected route (SR-1)', () => {
  let seed;
  beforeEach(async () => {
    seed = await seedTwoOrgs();
  });

  it.each(protectedRoutes)('$method $path → 401 without a session', async (route) => {
    const res = await send(route.method, withId(route.path)).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  const matrix = ROLE_LIST.flatMap((role) => protectedRoutes.map((route) => ({ role, ...route })));

  it.each(matrix)(
    '$role on $method $path is decided by the permission matrix',
    async ({ role, ...route }) => {
      const user = { ORG_ADMIN: seed.a.admin, APPROVER: seed.a.approver, MEMBER: seed.a.member }[
        role
      ];
      const res = await send(route.method, withId(route.path))
        .set('Cookie', accessCookieFor(user))
        .send({});
      if (roleHasPermission(role, route.permission)) {
        expect([401, 403]).not.toContain(res.status);
      } else {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    },
  );

  it('a rogue router.use() handler that slipped past the boot assertion is still refused at runtime', async () => {
    await withRogue(
      (router) => router.use('/secret/deep', (_req, res) => res.json({ served: true })),
      async () => {
        const unguarded = createApp({ skipRouteAssertion: true });
        const res = await request(unguarded)
          .get('/api/assets/secret/deep')
          .set('Cookie', accessCookieFor(seed.a.admin));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.served).toBeUndefined();
      },
    );
  });

  it('the response gate refuses any success response sent without an authorization decision', async () => {
    const mini = express();
    mini.use(denyByDefault);
    mini.get('/json', (_req, res) => res.json({ ok: true }));
    mini.get('/send', (_req, res) => res.send('ok'));
    mini.get('/end', (_req, res) => res.end());
    mini.get('/error', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
    for (const path of ['/json', '/send', '/end']) {
      const res = await request(mini).get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const err = await request(mini).get('/error');
    expect(err.status).toBe(404);
  });

  it('a token with an unknown role is rejected before any permission check', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Cookie', accessCookieFor({ ...seed.a.admin.toObject(), role: 'SUPERUSER' }));
    expect([401, 403]).toContain(res.status);
  });
});

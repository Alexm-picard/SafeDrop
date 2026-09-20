// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: every Sprint-1 stub returns 501 with its ticket; skipped acceptance tests name what each ticket must satisfy
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Integration tests for the Sprint 1 stubs, and the specification of what replaces them.
 *
 * Two halves. The first proves that every stubbed route is real: it authenticates, authorizes and
 * validates, then answers 501 with its owning ticket — and that validation still runs *before* the
 * stub, so bad input is a 400 rather than a 501. That is what makes the route surface testable now.
 *
 * The second half is a list of `it()` calls with no body: Vitest reports them as todo, so the
 * acceptance criteria agreed during design are recorded as pending tests rather than as prose that
 * can drift. Implementing a ticket means giving its todo a body.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { listRoutes } from '../../../src/routes/define.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';
import { ROLES } from '../../../src/utils/permissions.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

const stubs = [
  // GET /api/assets and GET /api/assets/:asset are no longer here: SCRUM-115 implemented them, so
  // they answer 200. Their acceptance criteria live in assets.test.js.
  {
    method: 'POST',
    path: '/api/assets',
    as: 'admin',
    body: { name: 'Camera', category: 'camera' },
  },
  { method: 'PATCH', path: '/api/assets/:asset', as: 'admin', body: { name: 'Camera 2' } },
  { method: 'POST', path: '/api/assets/:asset/retire', as: 'admin' },
  { method: 'POST', path: '/api/assets/:asset/units', as: 'admin', body: { tag: 'cam-001' } },
  // GET /api/requests is no longer here: SCRUM-119 implemented it — see requests.test.js.
  // POST /api/requests is no longer here: SCRUM-requests-create implemented it — see requests.test.js.
  // GET /api/requests/:request is no longer here: SCRUM-123 implemented it — see requests.test.js.
  // POST /api/requests/:request/approve and POST /api/requests/:request/deny are no longer here: SCRUM-119 implemented them — see
  // tests/integration/routes/requests.test.js.
  { method: 'POST', path: '/api/requests/:request/cancel', as: 'member' },

  // POST /api/requests/:request/checkout and /api/requests/:request/return are no longer here: SCRUM-120 implemented them — see
  // tests/integration/routes/requests.test.js.

  // GET /api/audit is no longer here: SCRUM-46 implemented it, so it answers 200. Its acceptance
  // criteria live in the un-skipped describe block below.
  // GET /api/users, POST /api/users/invite and PATCH /api/users/:id/role are no longer here: the
  // member-lifecycle ticket implemented them. Their acceptance criteria live in users.test.js.
];

const resolvePath = (path, s) =>
  path.replace(':asset', String(s.asset._id)).replace(':request', String(s.request._id));

describe('Sprint 1 stubs answer 501 NOT_IMPLEMENTED with their ticket', () => {
  it.each(stubs)('$method $path', async ({ method, path, as, body }) => {
    const res = await request(app)
      [method.toLowerCase()](resolvePath(path, seed.a))
      .set('Cookie', accessCookieFor(seed.a[as]))
      .set('Content-Type', 'application/json')
      .send(body ?? {});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.details.ticket).toMatch(/^SCRUM-/);
  });

  it('validation still runs before a stub (bad input is 400, not 501)', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: '', category: 'x', bogus: 1 });
    expect(res.status).toBe(400);
  });
});

// ---- Acceptance criteria owned by later tickets. Un-skip when implementing. ----------------------
describe.skip('SCRUM-assets-*: asset catalogue', () => {
  // GET /api/assets is no longer here: SCRUM-115 implemented it. Its acceptance criteria live in
  // assets.test.js.
  it(
    'POST /api/assets (ORG_ADMIN) creates an asset and appends ASSET_CREATED in the same transaction',
  );
  it('PATCH /api/assets/:id appends ASSET_UPDATED with before/after snapshots');
  it(
    'POST /api/assets/:id/retire refuses while a unit is OUT or HELD and otherwise appends ASSET_RETIRED',
  );
  it('POST /api/assets/:id/units rejects a duplicate tag within the org with 409');
});

// approve, deny, "POST /api/requests creates a PENDING request..." and "a MEMBER reading another
// member's request gets 404" are no longer here: SCRUM-119, SCRUM-requests-create and SCRUM-123
// implemented them — see requests.test.js. Only cancel is still unbuilt (SCRUM-requests-cancel).
describe.skip('SCRUM-requests-*: checkout workflow (F4 state machine)', () => {
  it('cancel by the requester moves PENDING/APPROVED → CANCELLED and frees a HELD unit');
});

describe('SCRUM-46: GET /api/audit', () => {
  /**
   * Append `count` extra events to one organisation, newest last.
   *
   * Sequential rather than concurrent on purpose: the events are inserted in a known order so the
   * newest-first assertion below is meaningful. Several may share a millisecond, which is exactly why
   * the repository sorts by `_id` after `timestamp` — ObjectIds rise monotonically within a process,
   * so the tiebreak makes the order deterministic instead of incidental.
   */
  const appendEvents = async (org, actions) => {
    for (const action of actions) {
      await auditRepo.append(org.orgId, {
        actorId: org.admin._id,
        actorRole: ROLES.ORG_ADMIN,
        action,
        targetType: AUDIT_TARGET_TYPE.Asset,
        targetId: org.asset._id,
      });
    }
  };

  it('returns the org’s events newest-first with page/limit and never another org’s events', async () => {
    // The fixture gives each org one ORG_CREATED event; add two more to A and one to B.
    await appendEvents(seed.a, [AUDIT_ACTION.ASSET_CREATED, AUDIT_ACTION.ASSET_UPDATED]);
    await appendEvents(seed.b, [AUDIT_ACTION.ASSET_RETIRED]);

    const page1 = await request(app)
      .get('/api/audit?limit=2')
      .set('Cookie', accessCookieFor(seed.a.admin));

    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(page1.body.items).toHaveLength(2);
    // Newest first: the two appended above, most recent one leading.
    expect(page1.body.items.map((e) => e.action)).toEqual([
      AUDIT_ACTION.ASSET_UPDATED,
      AUDIT_ACTION.ASSET_CREATED,
    ]);

    const page2 = await request(app)
      .get('/api/audit?limit=2&page=2')
      .set('Cookie', accessCookieFor(seed.a.admin));

    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].action).toBe(AUDIT_ACTION.ORG_CREATED);

    // SR-2: every row belongs to the caller's org, and B's event is nowhere in either page.
    const returned = [...page1.body.items, ...page2.body.items];
    expect(returned.every((e) => e.orgId === seed.a.orgId)).toBe(true);
    expect(returned.some((e) => e.action === AUDIT_ACTION.ASSET_RETIRED)).toBe(false);

    // And the same request as B sees only B's own two events.
    const asB = await request(app).get('/api/audit').set('Cookie', accessCookieFor(seed.b.admin));
    expect(asB.body.total).toBe(2);
    expect(asB.body.items.every((e) => e.orgId === seed.b.orgId)).toBe(true);
  });

  it('narrows by action, actor and date range', async () => {
    await appendEvents(seed.a, [AUDIT_ACTION.ASSET_CREATED, AUDIT_ACTION.ASSET_UPDATED]);

    const byAction = await request(app)
      .get(`/api/audit?action=${AUDIT_ACTION.ASSET_UPDATED}`)
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(byAction.body.total).toBe(1);
    expect(byAction.body.items[0].action).toBe(AUDIT_ACTION.ASSET_UPDATED);

    const byActor = await request(app)
      .get(`/api/audit?actorId=${String(seed.a.member._id)}`)
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(byActor.body.total).toBe(0);

    // Everything was written just now, so a window ending in the past matches nothing.
    const past = new Date(Date.now() - 60_000).toISOString();
    const byRange = await request(app)
      .get(`/api/audit?to=${encodeURIComponent(past)}`)
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(byRange.body.total).toBe(0);
  });

  it('there is no route that can update or delete an audit event (SR-8)', async () => {
    // Read the live Express stack rather than a list we maintain: it is what will actually run.
    const auditRoutes = listRoutes(app).filter((r) => r.path.startsWith('/api/audit'));
    expect(auditRoutes).toHaveLength(1);
    expect(auditRoutes[0]).toMatchObject({ method: 'GET', permission: 'audit:read' });

    // Belt and braces: even bypassing routing, the model refuses to mutate or remove a row.
    await expect(
      AuditEvent.updateOne({ _id: seed.a.audit._id }, { $set: { action: 'X' } }).exec(),
    ).rejects.toThrow();
    await expect(AuditEvent.deleteOne({ _id: seed.a.audit._id }).exec()).rejects.toThrow();
  });

  it('a MEMBER cannot read the audit log (SR-1)', async () => {
    const res = await request(app).get('/api/audit').set('Cookie', accessCookieFor(seed.a.member));
    expect(res.status).toBe(403);
  });

  it('rejects an operator-injection attempt in a filter (SR-6)', async () => {
    const res = await request(app)
      .get('/api/audit?actorId[$ne]=null')
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// The SCRUM-users-* acceptance criteria that used to be todos here are now real tests in users.test.js.

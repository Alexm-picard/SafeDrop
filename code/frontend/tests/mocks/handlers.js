/**
 * The mock API: fixture data and the default MSW handlers.
 *
 * Responses here mirror the real API's contracts exactly — `{ error: { code, message, details,
 * requestId } }` for failures, 501 with a `details.ticket` for unimplemented endpoints, 204 with no
 * body for logout. That fidelity is what makes the tests meaningful: if the shapes drifted, the tests
 * would pass against a client the real backend would break.
 *
 * The fixture users cover all three roles from one organisation, so role-based rendering can be tested
 * without building a user per test.
 *
 * Exports: the fixtures (`org`, `adminUser`, `approverUser`, `memberUser`, `summary`, `members`), the
 * builders (`errorResponse`, `notImplemented`, `meHandler`, `membersPage`) and the default `handlers`
 * array.
 */
import { http, HttpResponse } from 'msw';
export const org = {
  id: '6aab2a45c6e457e01ac0968a',
  name: 'Acme Robotics',
  slug: 'acme-robotics',
};
export const adminUser = {
  id: '6aab2a45c6e457e01ac0968b',
  orgId: org.id,
  email: 'ada@acme.test',
  name: 'Ada Admin',
  role: 'ORG_ADMIN',
};
export const approverUser = {
  ...adminUser,
  id: '6aab2a45c6e457e01ac0968c',
  email: 'ann@acme.test',
  name: 'Ann Approver',
  role: 'APPROVER',
};
export const memberUser = {
  ...adminUser,
  id: '6aab2a45c6e457e01ac0968d',
  email: 'max@acme.test',
  name: 'Max Member',
  role: 'MEMBER',
};
/** An invitation token the mock accepts, one it reports as expired, and (by elimination) any other is invalid. */
export const VALID_TOKEN = 'valid-invitation-token-0123456789abcdefghij';
export const EXPIRED_TOKEN = 'expired-invitation-token-0123456789abcdefgh';

export const summary = {
  totalAssets: 12,
  checkedOut: 4,
  available: 7,
  held: 1,
  retired: 2,
};
/**
 * Three assets for the caller's org, matching what the real API serialises: an `id` rather than
 * `_id`, and `retiredAt` present (null unless a test overrides it).
 */
export const assets = [
  {
    id: '6aab2a45c6e457e01ac0971a',
    orgId: org.id,
    name: 'Dell XPS 15',
    category: 'laptop',
    description: 'Developer laptop, 16GB RAM',
    imageUrl: null,
    retiredAt: null,
  },
  {
    id: '6aab2a45c6e457e01ac0971b',
    orgId: org.id,
    name: 'Canon EOS R6',
    category: 'camera',
    description: '',
    imageUrl: null,
    retiredAt: null,
  },
];
/** Units keyed by asset id, matching `AssetDetailPage`'s expectation of `data.units`. */
export const assetUnits = {
  [assets[0].id]: [
    {
      id: '6aab2a45c6e457e01ac0972a',
      assetId: assets[0].id,
      tag: 'xps-001',
      serial: 'SN-001',
      condition: 'GOOD',
      status: 'AVAILABLE',
    },
    {
      id: '6aab2a45c6e457e01ac0972b',
      assetId: assets[0].id,
      tag: 'xps-002',
      serial: 'SN-002',
      condition: 'FAIR',
      status: 'OUT',
    },
  ],
  [assets[1].id]: [
    {
      id: '6aab2a45c6e457e01ac0972c',
      assetId: assets[1].id,
      tag: 'cam-001',
      serial: null,
      condition: 'NEW',
      status: 'HELD',
    },
  ],
};
/**
 * Apply the pagination and filters the real `/api/assets` endpoint applies.
 * @param {URLSearchParams} search
 * @returns {{ items: object[], total: number, page: number, limit: number }}
 */
export function assetsPage(search) {
  const category = search.get('category');
  const includeRetired = search.get('includeRetired') === 'true';
  const filtered = assets.filter((a) => {
    if (!includeRetired && a.retiredAt) {
      return false;
    }
    if (category && a.category !== category) {
      return false;
    }
    return true;
  });
  const page = Number(search.get('page') ?? 1);
  const limit = Number(search.get('limit') ?? 25);
  const start = (page - 1) * limit;
  return { items: filtered.slice(start, start + limit), total: filtered.length, page, limit };
}
/**
 * 30 audit events, newest first — enough to page at the UI's 25 per page.
 *
 * The shape matches what the real API serialises: an `id` rather than `_id`, ObjectIds flattened to
 * strings, and a server-set `timestamp` (see models/base.js). The actions cycle so that filtering by
 * one action returns a predictable subset rather than everything or nothing.
 */
export const auditEvents = Array.from({ length: 30 }, (_, i) => {
  const actions = ['ASSET_CHECKED_OUT', 'REQUEST_APPROVED', 'ASSET_RETURNED'];
  const action = actions[i % actions.length];
  return {
    id: `6aab2a45c6e457e01ac09${String(700 + i).padStart(4, '0')}`,
    orgId: org.id,
    actorId: adminUser.id,
    actorRole: 'ORG_ADMIN',
    action,
    targetType: action === 'REQUEST_APPROVED' ? 'CheckoutRequest' : 'AssetUnit',
    targetId: `6aab2a45c6e457e01ac09${String(800 + i).padStart(4, '0')}`,
    before: null,
    after: null,
    requestId: `req-${i}`,
    // One event per day, walking backwards from a fixed date so the order is stable.
    timestamp: new Date(Date.UTC(2026, 8, 18) - i * 86_400_000).toISOString(),
  };
});
/**
 * Apply the audit filters and pagination the real endpoint applies.
 *
 * Mirroring the server here — rather than always returning the whole fixture array — is what lets a
 * test tell a working filter from one whose parameters never leave the browser.
 * @param {URLSearchParams} search
 * @returns {{ items: object[], total: number, page: number, limit: number }}
 */
export function auditPage(search) {
  const action = search.get('action');
  const targetType = search.get('targetType');
  const from = search.get('from');
  const to = search.get('to');
  const filtered = auditEvents.filter((e) => {
    if (action && e.action !== action) {
      return false;
    }
    if (targetType && e.targetType !== targetType) {
      return false;
    }
    if (from && e.timestamp < from) {
      return false;
    }
    if (to && e.timestamp > to) {
      return false;
    }
    return true;
  });
  const page = Number(search.get('page') ?? 1);
  const limit = Number(search.get('limit') ?? 25);
  const start = (page - 1) * limit;
  return { items: filtered.slice(start, start + limit), total: filtered.length, page, limit };
}
/**
 * The organisation's members as `GET /api/users` returns them: the three fixture users, oldest first,
 * each with the `createdAt` the real `publicUser()` includes.
 */
export const members = [adminUser, approverUser, memberUser].map((u, i) => ({
  ...u,
  createdAt: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
}));

/**
 * Apply the pagination the real `/api/users` endpoint applies.
 * @param {URLSearchParams} search
 * @param {object[]} [all] the members to page over; defaults to the fixture
 * @returns {{ items: object[], total: number, page: number, limit: number }}
 */
export function membersPage(search, all = members) {
  const page = Number(search.get('page') ?? 1);
  const limit = Number(search.get('limit') ?? 25);
  const start = (page - 1) * limit;
  return { items: all.slice(start, start + limit), total: all.length, page, limit };
}

/**
 * Build an error response in the API's exact envelope.
 *
 * Including a `requestId`, so tests can assert that ErrorState surfaces it — that id is what a user
 * quotes in a bug report.
 * @param {number} status HTTP status
 * @param {string} code machine-readable error code
 * @param {string} message
 * @param {unknown} [details] validation issues, or `{ ticket }` for a 501
 * @returns {Response}
 */
export function errorResponse(status, code, message, details) {
  return HttpResponse.json(
    { error: { code, message, details, requestId: 'req-test' } },
    { status },
  );
}
/**
 * Build the 501 response a stubbed backend route returns, carrying its owning ticket.
 * @param {string} ticket e.g. 'SCRUM-assets-list'
 * @returns {Response}
 */
export const notImplemented = (ticket) =>
  errorResponse(501, 'NOT_IMPLEMENTED', 'Not implemented yet', { ticket });
/**
 * Build a `GET /api/auth/me` handler answering as `user`, or 401 when `user` is null.
 *
 * The SPA decides whether there is a session by calling `/me`, so overriding this one handler is how
 * a test renders as any role — or as a signed-out visitor.
 * @param {object|null} user
 * @param {object} [organization]
 * @returns {import('msw').RequestHandler}
 */
export const meHandler = (user, organization = org) =>
  http.get('*/api/auth/me', () =>
    user
      ? HttpResponse.json({ user, organization })
      : errorResponse(401, 'UNAUTHENTICATED', 'Authentication required'),
  );
/**
 * The default handlers: signed in as the admin, with a working login, a failing refresh, and 501s
 * for every endpoint whose ticket has not landed.
 *
 * Refresh answers 401 by default so the retry path in services/api.js is exercised honestly — a test
 * that wants a successful refresh overrides it explicitly.
 */
export const handlers = [
  meHandler(adminUser),
  http.post('*/api/auth/login', async ({ request }) => {
    const body = await request.json();
    if (
      body.orgSlug === org.slug &&
      body.email === adminUser.email &&
      body.password === 'Correct-Horse-Battery-9'
    ) {
      return HttpResponse.json({ user: adminUser });
    }
    return errorResponse(401, 'UNAUTHENTICATED', 'Invalid email or password');
  }),
  http.post('*/api/auth/refresh', () =>
    errorResponse(401, 'UNAUTHENTICATED', 'Invalid refresh token'),
  ),
  http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/auth/accept-invite', async ({ request }) => {
    const body = await request.json();
    if (body.token === EXPIRED_TOKEN) {
      return errorResponse(400, 'INVITATION_EXPIRED', 'This invitation has expired');
    }
    if (body.token !== VALID_TOKEN) {
      return errorResponse(400, 'INVITATION_INVALID', 'This invitation link is not valid');
    }
    if (!body.password || body.password.length < 10) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'password', message: 'must be at least 10 characters' },
      ]);
    }
    return HttpResponse.json({ user: { ...memberUser, invitation: null }, organization: org });
  }),
  http.post('*/api/organizations', async ({ request }) => {
    const body = await request.json();
    if (!body.adminPassword || body.adminPassword.length < 10) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'adminPassword', message: 'must be at least 10 characters' },
      ]);
    }
    return HttpResponse.json(
      {
        organization: { ...org, name: body.orgName ?? org.name },
        user: { ...adminUser, name: body.adminName ?? adminUser.name },
      },
      { status: 201 },
    );
  }),
  http.get('*/api/dashboard/summary', () => HttpResponse.json(summary)),
  http.get('*/api/assets', ({ request }) =>
    HttpResponse.json(assetsPage(new URL(request.url).searchParams)),
  ),
  http.get('*/api/assets/:id', ({ params }) => {
    const asset = assets.find((a) => a.id === params.id);
    if (!asset) {
      return errorResponse(404, 'NOT_FOUND', 'Asset not found');
    }
    return HttpResponse.json({ ...asset, units: assetUnits[asset.id] ?? [] });
  }),
  http.get('*/api/users', ({ request }) =>
    HttpResponse.json(membersPage(new URL(request.url).searchParams)),
  ),
  http.post('*/api/users/invite', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        user: {
          id: '6aab2a45c6e457e01ac0968e',
          orgId: org.id,
          email: body.email,
          name: body.name,
          role: body.role ?? 'MEMBER',
          invitation: {
            status: 'PENDING',
            expiresAt: new Date(Date.UTC(2026, 8, 13)).toISOString(),
          },
          createdAt: new Date(Date.UTC(2026, 8, 10)).toISOString(),
        },
        delivery: 'email',
      },
      { status: 201 },
    );
  }),
  http.post('*/api/users/:id/resend-invite', ({ params }) => {
    const target = members.find((m) => m.id === params.id);
    if (!target) {
      return errorResponse(404, 'NOT_FOUND', 'User not found');
    }
    return HttpResponse.json({
      user: {
        ...target,
        invitation: {
          status: 'PENDING',
          expiresAt: new Date(Date.UTC(2026, 8, 16)).toISOString(),
        },
      },
      delivery: 'email',
    });
  }),
  http.patch('*/api/users/:id/role', async ({ params, request }) => {
    const { role } = await request.json();
    const target = members.find((m) => m.id === params.id);
    if (!target) {
      return errorResponse(404, 'NOT_FOUND', 'User not found');
    }
    return HttpResponse.json({ user: { ...target, role } });
  }),
  http.get('*/api/requests', () => notImplemented('SCRUM-requests-list')),
  http.get('*/api/audit', ({ request }) =>
    HttpResponse.json(auditPage(new URL(request.url).searchParams)),
  ),
];

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
 * Exports: the fixtures (`org`, `adminUser`, `approverUser`, `memberUser`, `summary`,
 * `activityDays`, `members`), the builders (`errorResponse`, `notImplemented`, `meHandler`,
 * `membersPage`, `assetHistoryPage`, `plainSearch`, `daysFromNow`) and the default `handlers` array.
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
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * An ISO instant `days` calendar days from now, at 5 pm local time.
 *
 * Relative rather than fixed, because the due badge (SCRUM-143) is computed against the clock: a
 * hard-coded `2026-09-14` reads as "Due in 2 days" the week it is written and "Overdue by 200 days"
 * a term later, so any test asserting on it rots. `activityDays` below is built from today for the
 * same reason.
 *
 * `setDate` rather than adding milliseconds, so the result is exactly `days` squares along the
 * calendar even across a daylight-saving change — adding 72 hours over a spring-forward lands four
 * days out, and calendar days are what the badge counts. 5 pm keeps it clear of midnight, so the day
 * it falls on cannot depend on the hour the suite happens to run.
 * @param {number} days negative for a date in the past
 * @returns {string} an ISO 8601 instant
 */
export function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}
/**
 * Thirty days of checkout activity ending today, as the API returns them: every day present, most of
 * them zero, one clear busiest day. The counts follow a fixed pattern rather than random numbers, so
 * a test can assert on the peak without knowing which date today is.
 * @param {number} [days]
 * @returns {Array<{ date: string, checkouts: number }>}
 */
export const activityDays = (days = 30) =>
  Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.now() - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10),
    checkouts: index === days - 3 ? 6 : index % 4 === 0 ? 2 : 0,
  }));
export const summary = {
  // Internally consistent, the way the API's own numbers are: totalAssets is available + held +
  // checkedOut + requested + maintenance (SCRUM-141), and excludes only the retired units.
  totalAssets: 15,
  checkedOut: 4,
  available: 7,
  held: 1,
  requested: 0,
  maintenance: 3,
  retired: 2,
  pendingRequests: 3,
  overdue: 2,
  activity: activityDays(),
};
/**
 * Three assets for the caller's org, matching what the real API serialises: an `id` rather than
 * `_id`, and `retiredAt` present (null unless a test overrides it). None is restricted (SCRUM-150):
 * `allowedGroupIds` and the resolved `allowedGroups` are empty unless a test overrides them.
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
    allowedGroupIds: [],
    allowedGroups: [],
    restricted: false,
  },
  {
    id: '6aab2a45c6e457e01ac0971b',
    orgId: org.id,
    name: 'Canon EOS R6',
    category: 'camera',
    description: '',
    imageUrl: null,
    retiredAt: null,
    allowedGroupIds: [],
    allowedGroups: [],
    restricted: false,
  },
];
/**
 * The caller's org's user groups (SCRUM-149), as `GET /api/groups` serialises them. SCRUM-150
 * restricts assets to these: the asset form offers them as a picker, and a restricted asset names
 * them on its Restricted badge.
 */
export const groups = [
  {
    id: '6aab2a45c6e457e01ac09a01',
    orgId: org.id,
    name: 'Certified Drone Pilots',
    description: 'Passed the drone safety course',
    memberIds: [memberUser.id],
    memberCount: 1,
  },
  {
    id: '6aab2a45c6e457e01ac09a02',
    orgId: org.id,
    name: 'Heavy Machinery Certified',
    description: '',
    memberIds: [],
    memberCount: 0,
  },
];

/**
 * A group as `GET /api/groups/:id` returns it: its fields plus `members`, each resolved through the
 * same `publicUser()` shape `/api/users` uses (so `deactivatedAt` is present).
 * @param {object} group one of `groups`
 * @returns {object}
 */
export function groupWithMembers(group) {
  const users = [adminUser, approverUser, memberUser];
  return {
    ...group,
    members: group.memberIds
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => ({ ...u, deactivatedAt: null })),
    // SCRUM-204: the equipment restricted to this group; none in the fixture unless a test says so.
    restrictedAssets: [],
  };
}

/**
 * What `GET /api/assets/:id/alternatives` answers (SCRUM-151).
 *
 * The recommended assets deliberately are not members of `assets` above: the endpoint returns the
 * fields the section renders rather than ids to look up, so the fixture should not imply the page
 * needs the catalogue loaded as well. A test that wants the fallback shape overrides this handler with
 * `reason: null` and `aiAssisted: false`.
 */
export const similarItems = {
  alternatives: [
    {
      assetId: '6aab2a45c6e457e01ac0973a',
      name: 'Sony A7 IV',
      category: 'camera',
      description: 'Full-frame mirrorless',
      reason: 'Full-frame mirrorless like the R6, two available now',
    },
  ],
  aiAssisted: true,
};

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
 * Answer `GET /api/assets/search` the way the real API does with AI off (SCRUM-200): a
 * case-insensitive match on name, description and category over the non-retired assets, sorted by
 * name, with no reasons and no clarification.
 * @param {URLSearchParams} search
 * @returns {{ matches: object[], clarification: null, aiAssisted: false }}
 */
export function plainSearch(search) {
  const q = (search.get('q') ?? '').toLowerCase();
  const matches = assets
    .filter((a) => !a.retiredAt)
    .filter((a) => [a.name, a.description, a.category].some((f) => f.toLowerCase().includes(q)))
    .sort((x, y) => x.name.localeCompare(y.name))
    // SCRUM-202: each match carries the asset's restriction fields, as the real search does.
    .map(({ id, name, category, description, allowedGroups, restricted }) => ({
      assetId: id,
      name,
      category,
      description,
      allowedGroups,
      restricted,
    }));
  return { matches, clarification: null, aiAssisted: false };
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
  // Ten events each, in blocks rather than round-robin. Round-robin over three actors would line up
  // exactly with the three-action cycle, so "filtered by actor" and "filtered by action" would select
  // the same rows and neither test could tell the two filters apart.
  const actor = [adminUser, approverUser, memberUser][Math.floor(i / 10)];
  return {
    id: `6aab2a45c6e457e01ac09${String(700 + i).padStart(4, '0')}`,
    orgId: org.id,
    actorId: actor.id,
    actorRole: actor.role,
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
  const actorId = search.get('actorId');
  const action = search.get('action');
  const targetType = search.get('targetType');
  const from = search.get('from');
  const to = search.get('to');
  const filtered = auditEvents.filter((e) => {
    if (actorId && e.actorId !== actorId) {
      return false;
    }
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
 * 30 history events for the first asset — enough to page at the UI's 25 per page (SCRUM-29).
 *
 * The shape matches what `GET /api/assets/:id/history` serialises: an audit event plus the resolved
 * `actor` and the `unitTag` of the unit it concerned. Three actors and two target types, so a test
 * can tell "shows the actor's display name" from "shows whatever the first row happened to hold",
 * and an asset-level event with `unitTag: null` proves the unit column is omitted rather than faked.
 */
export const assetHistoryEvents = Array.from({ length: 30 }, (_, i) => {
  const actors = [adminUser, approverUser, memberUser];
  const actor = actors[i % actors.length];
  const isAssetLevel = i === 29;
  return {
    id: `6aab2a45c6e457e01ac09${String(900 + i).padStart(4, '0')}`,
    orgId: org.id,
    actorId: actor.id,
    actorRole: actor.role,
    action: isAssetLevel ? 'ASSET_CREATED' : ['ASSET_CHECKED_OUT', 'ASSET_RETURNED'][i % 2],
    targetType: isAssetLevel ? 'Asset' : 'AssetUnit',
    targetId: isAssetLevel ? assets[0].id : assetUnits[assets[0].id][i % 2].id,
    before: null,
    after: null,
    requestId: `req-h-${i}`,
    // One event per day, walking backwards from a fixed date so the order is stable.
    timestamp: new Date(Date.UTC(2026, 8, 18) - i * 86_400_000).toISOString(),
    actor: { id: actor.id, name: actor.name, role: actor.role },
    unitTag: isAssetLevel ? null : assetUnits[assets[0].id][i % 2].tag,
  };
});
/**
 * Apply the pagination the real history endpoint applies, around the asset it belongs to.
 * @param {URLSearchParams} search
 * @param {object[]} [events]
 * @returns {{ asset: object, items: object[], total: number, page: number, limit: number }}
 */
export function assetHistoryPage(search, events = assetHistoryEvents) {
  const page = Number(search.get('page') ?? 1);
  const limit = Number(search.get('limit') ?? 25);
  const start = (page - 1) * limit;
  return {
    asset: { id: assets[0].id, name: assets[0].name, category: assets[0].category },
    items: events.slice(start, start + limit),
    total: events.length,
    page,
    limit,
  };
}
/**
 * Four checkout requests for the caller's org, one per state the approval queue actually exercises:
 * PENDING (approve/deny), APPROVED (checkout), CHECKED_OUT (return), and DENIED — a terminal state
 * with no action, so a test can prove the actions column renders nothing rather than merely having
 * no row to check.
 *
 * Only the CHECKED_OUT one carries a `dueAt`, which is how the API behaves: nothing is due back
 * until it has been handed over. That makes it the row the due badge (SCRUM-143) appears on, and the
 * others the rows that prove it stays away.
 */
export const checkoutRequests = [
  {
    id: '6aab2a45c6e457e01ac0973a',
    orgId: org.id,
    unitId: '6aab2a45c6e457e01ac0972a',
    requesterId: memberUser.id,
    state: 'PENDING',
    neededFrom: '2026-10-01T00:00:00.000Z',
    neededTo: '2026-10-15T00:00:00.000Z',
    note: '',
    decidedBy: null,
    decidedAt: null,
    decisionNote: '',
    checkedOutAt: null,
    dueAt: null,
    returnedAt: null,
  },
  {
    id: '6aab2a45c6e457e01ac0973b',
    orgId: org.id,
    unitId: '6aab2a45c6e457e01ac0972b',
    requesterId: memberUser.id,
    state: 'APPROVED',
    neededFrom: '2026-09-20T00:00:00.000Z',
    neededTo: '2026-09-30T00:00:00.000Z',
    note: '',
    decidedBy: approverUser.id,
    decidedAt: '2026-09-19T00:00:00.000Z',
    decisionNote: '',
    checkedOutAt: null,
    dueAt: null,
    returnedAt: null,
  },
  {
    id: '6aab2a45c6e457e01ac0973c',
    orgId: org.id,
    unitId: '6aab2a45c6e457e01ac0972c',
    requesterId: memberUser.id,
    state: 'CHECKED_OUT',
    neededFrom: '2026-09-01T00:00:00.000Z',
    neededTo: '2026-09-14T00:00:00.000Z',
    note: '',
    decidedBy: approverUser.id,
    decidedAt: '2026-08-31T00:00:00.000Z',
    decisionNote: '',
    checkedOutAt: '2026-09-01T00:00:00.000Z',
    // Relative, so the due badge this row carries (SCRUM-143) reads the same in every run. A fixed
    // date here would drift further overdue with every week that passes.
    dueAt: daysFromNow(3),
    returnedAt: null,
  },
  {
    id: '6aab2a45c6e457e01ac0973d',
    orgId: org.id,
    unitId: '6aab2a45c6e457e01ac0972a',
    requesterId: memberUser.id,
    state: 'DENIED',
    neededFrom: '2026-08-01T00:00:00.000Z',
    neededTo: '2026-08-10T00:00:00.000Z',
    note: '',
    decidedBy: approverUser.id,
    decidedAt: '2026-07-31T00:00:00.000Z',
    decisionNote: 'Not eligible',
    checkedOutAt: null,
    dueAt: null,
    returnedAt: null,
  },
];
/**
 * Apply the state filter and pagination the real `/api/requests` endpoint applies.
 *
 * `scope` isn't modeled here: the fixture has no per-role visibility rules to mirror, so every test
 * sees the same organisation-wide list regardless of who is asking, the same simplification the
 * assets and audit fixtures already make.
 * @param {URLSearchParams} search
 * @returns {{ items: object[], total: number, page: number, limit: number }}
 */
export function requestsPage(search) {
  const state = search.get('state');
  const filtered = state ? checkoutRequests.filter((r) => r.state === state) : checkoutRequests;
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
/**
 * The one reset token the mocked API accepts; anything else is treated as expired or already used.
 */
export const VALID_RESET_TOKEN = 'valid-reset-token';

/**
 * The password the mocked change-password endpoint treats as the caller's current one.
 */
export const CURRENT_PASSWORD = 'Correct-Horse-Battery-9';

export function errorResponse(status, code, message, details) {
  return HttpResponse.json(
    { error: { code, message, details, requestId: 'req-test' } },
    { status },
  );
}
/**
 * Build the 501 response a stubbed backend route returns, carrying its owning ticket.
 * @param {string} ticket e.g. 'SCRUM-115'
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
  // Password reset (SCRUM-22). The real API answers 202 to every forgot-password request, whether
  // or not the account exists, so this mock does the same — a test that could tell them apart here
  // would be testing something the backend deliberately does not do.
  http.post('*/api/auth/change-password', async ({ request }) => {
    const body = await request.json();
    if (String(body.newPassword ?? '').length < 10) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'newPassword', message: 'must be at least 10 characters' },
      ]);
    }
    if (body.currentPassword !== CURRENT_PASSWORD) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'currentPassword', message: 'is incorrect' },
      ]);
    }
    // The real API clears mustChangePassword and issues a fresh session here.
    return HttpResponse.json({ user: { ...adminUser, mustChangePassword: false } });
  }),
  http.post('*/api/users/:id/password', async ({ request, params }) => {
    const body = await request.json();
    if (String(body.password ?? '').length < 10) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'password', message: 'must be at least 10 characters' },
      ]);
    }
    return HttpResponse.json({
      user: { ...memberUser, id: params.id, mustChangePassword: true },
    });
  }),
  http.post('*/api/auth/forgot-password', () =>
    HttpResponse.json(
      { message: 'If that account exists, a reset link is on its way.' },
      { status: 202 },
    ),
  ),
  http.post('*/api/auth/reset-password', async ({ request }) => {
    const body = await request.json();
    if (String(body.newPassword ?? '').length < 10) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'newPassword', message: 'must be at least 10 characters' },
      ]);
    }
    if (body.token !== VALID_RESET_TOKEN) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
        { location: 'body', path: 'token', message: 'this reset link is no longer valid' },
      ]);
    }
    return new HttpResponse(null, { status: 204 });
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
  // SCRUM-148: the organisation's approval default. REQUIRED is what every organisation starts with.
  http.get('*/api/organizations/me/approval-settings', () =>
    HttpResponse.json({ defaultMode: 'REQUIRED' }),
  ),
  http.patch('*/api/organizations/me/approval-settings', async ({ request }) => {
    const { defaultMode } = await request.json();
    return HttpResponse.json({ defaultMode });
  }),
  // SCRUM-205: the pickup grace period. 48 hours is every organisation's default.
  http.get('*/api/organizations/me/pickup-settings', () => HttpResponse.json({ graceHours: 48 })),
  http.patch('*/api/organizations/me/pickup-settings', async ({ request }) => {
    const { graceHours } = await request.json();
    return HttpResponse.json({ graceHours });
  }),
  http.get('*/api/dashboard/summary', () => HttpResponse.json(summary)),
  http.get('*/api/assets', ({ request }) =>
    HttpResponse.json(assetsPage(new URL(request.url).searchParams)),
  ),
  // Before `:id`, as on the server: otherwise "search" would be read as an asset id.
  http.get('*/api/assets/search', ({ request }) =>
    HttpResponse.json(plainSearch(new URL(request.url).searchParams)),
  ),
  http.get('*/api/assets/:id/alternatives', () => HttpResponse.json(similarItems)),
  http.get('*/api/assets/:id/history', ({ request }) =>
    HttpResponse.json(assetHistoryPage(new URL(request.url).searchParams)),
  ),
  http.get('*/api/assets/:id', ({ params }) => {
    const asset = assets.find((a) => a.id === params.id);
    if (!asset) {
      return errorResponse(404, 'NOT_FOUND', 'Asset not found');
    }
    // `eligible` is the caller's own answer (SCRUM-150); an unrestricted asset is open to everyone.
    return HttpResponse.json({ ...asset, units: assetUnits[asset.id] ?? [], eligible: true });
  }),
  // The four asset write endpoints (SCRUM-122). These answer as the *finished* backend will, not as
  // it does today: the services behind them are still 501 stubs owned by SCRUM-134,
  // -update, -retire and -units. Mocking the intended contract is what lets the UI be built and
  // tested now; when those tickets land, these handlers are what the real responses are checked
  // against. A test that wants a failure overrides the one handler it cares about with `server.use`.
  http.post('*/api/assets', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        id: '6aab2a45c6e457e01ac0971f',
        orgId: org.id,
        retiredAt: null,
        ...body,
      },
      { status: 201 },
    );
  }),
  http.patch('*/api/assets/:id', async ({ params, request }) => {
    const asset = assets.find((a) => a.id === params.id);
    if (!asset) {
      return errorResponse(404, 'NOT_FOUND', 'Asset not found');
    }
    return HttpResponse.json({ ...asset, ...(await request.json()) });
  }),
  http.post('*/api/assets/:id/retire', ({ params }) => {
    const asset = assets.find((a) => a.id === params.id);
    if (!asset) {
      return errorResponse(404, 'NOT_FOUND', 'Asset not found');
    }
    return HttpResponse.json({ ...asset, retiredAt: '2026-09-19T12:00:00.000Z' });
  }),
  http.post('*/api/assets/:id/units', async ({ params, request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        id: '6aab2a45c6e457e01ac0972f',
        orgId: org.id,
        assetId: params.id,
        status: 'AVAILABLE',
        ...body,
      },
      { status: 201 },
    );
  }),
  // Unit maintenance (SCRUM-141). Unlike the four above, these mirror a backend that is already
  // implemented rather than a planned contract: both answer with the updated unit, and the conflict
  // and 404 cases are overridden per test by whichever test cares about them.
  http.post('*/api/assets/:id/units/:unitId/maintenance', ({ params }) => {
    const unit = (assetUnits[params.id] ?? []).find((u) => u.id === params.unitId);
    if (!unit) {
      return errorResponse(404, 'NOT_FOUND', 'Unit not found');
    }
    return HttpResponse.json({ ...unit, status: 'MAINTENANCE' });
  }),
  http.post('*/api/assets/:id/units/:unitId/maintenance/end', ({ params }) => {
    const unit = (assetUnits[params.id] ?? []).find((u) => u.id === params.unitId);
    if (!unit) {
      return errorResponse(404, 'NOT_FOUND', 'Unit not found');
    }
    return HttpResponse.json({ ...unit, status: 'AVAILABLE' });
  }),
  http.get('*/api/requests', ({ request }) =>
    HttpResponse.json(requestsPage(new URL(request.url).searchParams)),
  ),
  // Opening a request (SCRUM-124). Answers as the finished backend will, not as it does today: the
  // service behind this route is still a 501 stub owned by SCRUM-135. A test that wants
  // the "somebody else took it" race overrides this with its own 409.
  http.post('*/api/requests', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        id: '6aab2a45c6e457e01ac0973f',
        orgId: org.id,
        requesterId: memberUser.id,
        state: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
        checkedOutAt: null,
        dueAt: null,
        returnedAt: null,
        ...body,
      },
      { status: 201 },
    );
  }),
  http.get('*/api/requests/:id', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    if (!found) {
      // What the real API answers for another member's request and for one that never existed:
      // the same 404, so neither can be told from the other (SR-2).
      return errorResponse(404, 'NOT_FOUND', 'Request not found');
    }
    const unit = Object.values(assetUnits)
      .flat()
      .find((u) => u.id === found.unitId);
    const asset = unit ? assets.find((a) => a.id === unit.assetId) : null;
    return HttpResponse.json({
      request: found,
      asset,
      unit,
      requester: { id: memberUser.id, name: memberUser.name, email: memberUser.email },
      decidedBy: found.decidedBy
        ? { id: approverUser.id, name: approverUser.name, email: approverUser.email }
        : null,
      timeline: [
        { at: '2026-09-18T00:00:00.000Z', event: 'SUBMITTED' },
        ...(found.decidedAt ? [{ at: found.decidedAt, event: 'APPROVED' }] : []),
        ...(found.checkedOutAt ? [{ at: found.checkedOutAt, event: 'CHECKED_OUT' }] : []),
      ],
    });
  }),
  http.post('*/api/requests/:id/approve', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'APPROVED' });
  }),
  http.post('*/api/requests/:id/deny', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'DENIED' });
  }),
  http.post('*/api/requests/:id/checkout', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'CHECKED_OUT' });
  }),
  http.post('*/api/requests/:id/return', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'RETURNED' });
  }),
  // Custody confirmation (SCRUM-205), mirroring the implemented backend.
  http.post('*/api/requests/:id/initiate-return', async ({ params, request }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    const { condition, note } = await request.json();
    return HttpResponse.json({
      ...(found ?? {}),
      id: params.id,
      state: 'RETURN_PENDING',
      reportedCondition: condition,
      reportedNote: note ?? '',
      returnInitiatedAt: '2026-10-03T12:00:00.000Z',
    });
  }),
  http.post('*/api/requests/:id/reject-return', ({ params }) => {
    const found = checkoutRequests.find((r) => r.id === params.id);
    return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'CHECKED_OUT' });
  }),
  http.post('*/api/requests/expire-approvals', () => HttpResponse.json({ expired: 0 })),
  // SCRUM-149's /api/groups, as the merged backend answers it (SCRUM-167 builds the screen). Add and
  // remove return the group *without* resolved members, which is why the screen re-reads the group.
  http.get('*/api/groups', () =>
    HttpResponse.json({ items: groups, total: groups.length, page: 1, limit: 100 }),
  ),
  http.post('*/api/groups', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        group: {
          id: '6aab2a45c6e457e01ac09a0f',
          orgId: org.id,
          description: '',
          ...body,
          memberIds: [],
          memberCount: 0,
        },
      },
      { status: 201 },
    );
  }),
  http.get('*/api/groups/:id', ({ params }) => {
    const group = groups.find((g) => g.id === params.id);
    if (!group) {
      return errorResponse(404, 'NOT_FOUND', 'Group not found');
    }
    return HttpResponse.json({ group: groupWithMembers(group) });
  }),
  http.patch('*/api/groups/:id', async ({ params, request }) => {
    const group = groups.find((g) => g.id === params.id);
    if (!group) {
      return errorResponse(404, 'NOT_FOUND', 'Group not found');
    }
    return HttpResponse.json({ group: { ...group, ...(await request.json()) } });
  }),
  http.delete('*/api/groups/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('*/api/groups/:id/members', async ({ params, request }) => {
    const group = groups.find((g) => g.id === params.id);
    const { userId } = await request.json();
    const memberIds = [...new Set([...group.memberIds, userId])];
    return HttpResponse.json({ group: { ...group, memberIds, memberCount: memberIds.length } });
  }),
  http.delete('*/api/groups/:id/members/:userId', ({ params }) => {
    const group = groups.find((g) => g.id === params.id);
    const memberIds = group.memberIds.filter((id) => id !== params.userId);
    return HttpResponse.json({ group: { ...group, memberIds, memberCount: memberIds.length } });
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
          createdAt: new Date(Date.UTC(2026, 8, 10)).toISOString(),
        },
      },
      { status: 201 },
    );
  }),
  http.patch('*/api/users/:id/role', async ({ params, request }) => {
    const { role } = await request.json();
    const target = members.find((m) => m.id === params.id);
    if (!target) {
      return errorResponse(404, 'NOT_FOUND', 'User not found');
    }
    return HttpResponse.json({ user: { ...target, role } });
  }),
  http.get('*/api/audit', ({ request }) =>
    HttpResponse.json(auditPage(new URL(request.url).searchParams)),
  ),
];

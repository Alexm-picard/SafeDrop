// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: MSW fixtures and default happy-path handlers for every endpoint, plus helpers to override per test
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 * Exports: the fixtures (`org`, `adminUser`, `approverUser`, `memberUser`, `summary`), the builders
 * (`errorResponse`, `notImplemented`, `meHandler`) and the default `handlers` array.
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
export const summary = {
  totalAssets: 12,
  checkedOut: 4,
  available: 7,
  held: 1,
  retired: 2,
};
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
  http.get('*/api/assets', () => notImplemented('SCRUM-assets-list')),
  http.get('*/api/assets/:id', () => notImplemented('SCRUM-assets-read')),
  http.get('*/api/requests', () => notImplemented('SCRUM-requests-list')),
  http.get('*/api/audit', () => notImplemented('SCRUM-audit-log')),
];

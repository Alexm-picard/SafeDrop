// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: smoke test: every route renders its heading for an ORG_ADMIN; placeholders show their ticket; AuthProvider bootstraps from /me
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for routing and session bootstrapping, against the real route table.
 *
 * Covers what only an end-to-end mount can show: a MEMBER is bounced from `/admin` to the catalogue
 * with a notice, unknown paths render the 404 page, and `AuthProvider` establishes the session from
 * `GET /api/auth/me` on load.
 *
 * The two expiry tests matter most. A 401 from `/me` (after a failed refresh) must land on the login
 * page, and a session that dies *mid-use* must do the same — that second case is the `expired` event
 * from services/api.js travelling to AuthProvider, which no smaller test exercises.
 */
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import App from '../../../src/App';
import { render } from '@testing-library/react';
import { adminUser, memberUser, meHandler } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { authenticatedState, renderApp } from '../../utils/render';
describe('routes', () => {
  it.each([
    ['/', 'Catalog', 'SCRUM-assets-list'],
    ['/assets/6aab2a45c6e457e01ac0968a', 'Asset', 'SCRUM-assets-read'],
    ['/requests', 'My requests', 'SCRUM-requests-list'],
    ['/admin', 'Dashboard', null],
    ['/admin/approvals', 'Approval queue', 'SCRUM-requests-approve'],
    ['/admin/audit', 'Audit log', 'SCRUM-audit-log'],
  ])('%s renders "%s" for an ORG_ADMIN', async (route, heading, ticket) => {
    renderApp(route, authenticatedState(adminUser));
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    if (ticket) {
      expect((await screen.findAllByText(ticket)).length).toBeGreaterThan(0);
      // The stubbed API answers 501, which the page surfaces as an ErrorState naming the ticket.
      expect(await screen.findByRole('alert')).toHaveTextContent('Not implemented yet');
    }
  });
  it('a MEMBER is bounced from /admin to the catalog with a notice', async () => {
    const { router } = renderApp('/admin', authenticatedState(memberUser));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('alert').some((a) => /do not have access/.test(a.textContent ?? '')),
    ).toBe(true);
  });
  it('unknown paths render the 404 page', async () => {
    renderApp('/definitely/not/here', authenticatedState(adminUser));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
  it('AuthProvider bootstraps the session from GET /api/auth/me', async () => {
    server.use(meHandler(adminUser));
    renderApp('/admin');
    expect(screen.getByRole('status')).toHaveTextContent(/checking/i);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Ada Admin/)).toBeInTheDocument();
  });
  it('a 401 from /me (after a failed refresh) lands on the login page', async () => {
    server.use(meHandler(null));
    const { router } = renderApp('/requests');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
  it('a session that expires mid-use sends the user to the login page', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/dashboard/summary', () => {
        calls += 1;
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'expired' } },
          { status: 401 },
        );
      }),
    );
    const { router } = renderApp('/admin', authenticatedState(adminUser));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(calls).toBeGreaterThan(0);
  });
  it('App mounts with a browser router', async () => {
    server.use(meHandler(null));
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
  });
});

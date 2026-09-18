// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: RequireRole renders children for allowed roles and redirects otherwise; RequireAuth handles loading/anonymous/authenticated
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the route guards.
 *
 * `RequireRole`: the right roles get through, the wrong ones and a missing role are redirected home
 * with the denial notice.
 *
 * `RequireAuth`: the `loading` state must render a loading indicator rather than a redirect — treating
 * an unresolved session as "signed out" would bounce an authenticated user to the login page on every
 * page refresh — and an anonymous user is redirected with the attempted path remembered.
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequireAuth } from '../../../src/components/RequireAuth';
import { RequireRole } from '../../../src/components/RequireRole';
import { adminUser, approverUser, memberUser } from '../../mocks/handlers';
import { renderWithAuth } from '../../utils/render';
const Secret = () => <h1>Secret</h1>;
const Home = () => <h1>Home</h1>;
const Login = () => <h1>Login</h1>;
describe('RequireRole', () => {
  it.each([
    ['ORG_ADMIN', adminUser, true],
    ['APPROVER', approverUser, true],
    ['MEMBER', memberUser, false],
  ])('%s → allowed=%s for roles [APPROVER, ORG_ADMIN]', async (_label, user, allowed) => {
    const { router } = renderWithAuth(
      <RequireRole roles={['APPROVER', 'ORG_ADMIN']}>
        <Secret />
      </RequireRole>,
      {
        user,
        route: '/secret',
        extraRoutes: [
          {
            path: '/secret',
            element: (
              <RequireRole roles={['APPROVER', 'ORG_ADMIN']}>
                <Secret />
              </RequireRole>
            ),
          },
          { path: '/home', element: <Home /> },
        ],
      },
    );
    if (allowed) {
      expect(await screen.findByRole('heading', { name: 'Secret' })).toBeInTheDocument();
    } else {
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(screen.queryByRole('heading', { name: 'Secret' })).not.toBeInTheDocument();
      expect(router.state.location.state).toEqual({ denied: true });
    }
  });
  it('redirects when there is no role at all', async () => {
    const { router } = renderWithAuth(
      <RequireRole roles={['ORG_ADMIN']}>
        <Secret />
      </RequireRole>,
      {
        user: null,
        route: '/x',
        extraRoutes: [
          {
            path: '/x',
            element: (
              <RequireRole roles={['ORG_ADMIN']}>
                <Secret />
              </RequireRole>
            ),
          },
        ],
      },
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
describe('RequireAuth', () => {
  const layout = (path) => [
    { path, element: <RequireAuth />, children: [{ index: true, element: <Secret /> }] },
    { path: '/login', element: <Login /> },
  ];
  it('shows a loading state while the session is being checked', () => {
    renderWithAuth(<Home />, {
      user: null,
      status: 'loading',
      route: '/p',
      extraRoutes: layout('/p'),
    });
    expect(screen.getByRole('status')).toHaveTextContent(/checking/i);
  });
  it('redirects an anonymous user to /login and remembers where they were', async () => {
    const { router } = renderWithAuth(<Home />, {
      user: null,
      route: '/p',
      extraRoutes: layout('/p'),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toEqual({ from: '/p' });
    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
  });
  it('renders the outlet for an authenticated user', async () => {
    renderWithAuth(<Home />, { user: memberUser, route: '/p', extraRoutes: layout('/p') });
    expect(await screen.findByRole('heading', { name: 'Secret' })).toBeInTheDocument();
  });
});

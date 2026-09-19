// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Layout tests: landmarks, role-aware navigation, sign out
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the application shell.
 *
 * Covers the accessibility structure — landmarks, the skip link, the signed-in user's details — and
 * signing out, which must both end the session and navigate to `/login`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Layout } from '../../../src/components/Layout';
import { adminUser, approverUser, memberUser } from '../../mocks/handlers';
import { renderWithAuth } from '../../utils/render';
const Page = () => <h1>Page</h1>;
const Login = () => <h1>Login</h1>;
/**
 * Render the Layout for a given user, with a `/login` destination registered.
 *
 * The extra route exists so the sign-out test can assert on where it landed rather than only on the
 * router's internal state.
 * @param {object} user
 * @returns {{ router: object, value: object } & import('@testing-library/react').RenderResult}
 */
function renderLayout(user) {
  return renderWithAuth(<Page />, {
    user,
    route: '/',
    extraRoutes: [
      { path: '/', element: <Layout />, children: [{ index: true, element: <Page /> }] },
      { path: '/login', element: <Login /> },
    ],
  });
}
describe('Layout', () => {
  it('has landmarks, a skip link and the signed-in user', () => {
    renderLayout(memberUser);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByText(/Max Member/)).toHaveTextContent('Acme Robotics');
  });
  it.each([
    [memberUser, ['Catalog', 'My requests']],
    [approverUser, ['Catalog', 'My requests', 'Approvals']],
    [adminUser, ['Catalog', 'My requests', 'Approvals', 'Dashboard', 'Members', 'Audit log']],
  ])('shows navigation by role', (user, expected) => {
    renderLayout(user);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(expected);
  });
  it('signs out and goes to /login', async () => {
    const user = userEvent.setup();
    const { router, value } = renderLayout(adminUser);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(value.logout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

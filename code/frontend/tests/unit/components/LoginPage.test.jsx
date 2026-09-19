// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: LoginPage tests: submit, 401 error, redirect on success (MSW), redirect back to the page the user came from
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the login page.
 *
 * Covers the accessible form structure, the failure paths (a 401 keeps the user on the page with the
 * API's message; an unreachable API shows a generic one), and the navigation rules: a successful
 * login lands on the screen for the caller's role (SCRUM-21), or back on the protected page the user
 * was originally sent from, and an already-authenticated visitor is redirected away from the form.
 *
 * The landing tests assert the destination *and* that its heading rendered, so a path that no longer
 * resolves to the intended screen fails here rather than passing as a bare string comparison.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminUser, approverUser, meHandler, memberUser } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { anonymousState, renderApp } from '../../utils/render';

/**
 * Sign the next login in as `user`, whatever credentials the form sends.
 *
 * The default login handler only ever answers with the admin, so a role test has to override both
 * it and `/me`: the first is what the form calls, the second is what the session bootstrap and the
 * background organisation fetch call afterwards.
 * @param {object} user
 * @returns {void}
 */
function signInAs(user) {
  server.use(
    http.post('*/api/auth/login', () => HttpResponse.json({ user })),
    meHandler(user),
  );
}
/**
 * Fill in the three login fields and submit.
 *
 * Drives the form through user-event — real typing and clicking rather than direct state changes —
 * so the test exercises what a user actually does, including the disabled-while-pending button.
 * @param {object} user a user-event instance
 * @param {string} password the password to type
 * @returns {Promise<void>}
 */
async function fillAndSubmit(user, password) {
  await user.type(screen.getByLabelText('Organization'), 'acme-robotics');
  await user.type(screen.getByLabelText('Email'), 'ada@acme.test');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}
describe('LoginPage', () => {
  it('renders labelled fields and a link to organization setup', () => {
    renderApp('/login', anonymousState);
    expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toBeRequired();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('link', { name: /create an organization/i })).toHaveAttribute(
      'href',
      '/setup',
    );
  });
  it('shows the API error on 401 and keeps the user on the page', async () => {
    const user = userEvent.setup();
    renderApp('/login', anonymousState);
    await fillAndSubmit(user, 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it.each([
    ['member', memberUser, '/requests', 'My requests'],
    ['approver', approverUser, '/admin/approvals', 'Approval queue'],
    ['admin', adminUser, '/admin', 'Dashboard'],
  ])('lands a %s on their own screen after signing in', async (_role, who, path, heading) => {
    const user = userEvent.setup();
    signInAs(who);
    const { router } = renderApp('/login', anonymousState);
    await fillAndSubmit(user, 'Correct-Horse-Battery-9');
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
  it('returns to the protected page the user was sent from', async () => {
    const user = userEvent.setup();
    server.use(meHandler(null));
    const { router } = renderApp('/admin');
    // RequireAuth redirects an anonymous user to /login and remembers /admin.
    await screen.findByRole('heading', { level: 1, name: /sign in/i });
    server.use(meHandler(adminUser));
    await fillAndSubmit(user, 'Correct-Horse-Battery-9');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
  it('shows a generic message when the API is unreachable', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/auth/login', () => HttpResponse.error()));
    renderApp('/login', anonymousState);
    await fillAndSubmit(user, 'whatever-whatever');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
  it('sends an already signed-in visitor to their landing screen', async () => {
    // No initialState: the session comes from the default /me handler, which is the admin.
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('sends an already signed-in member to their requests, not the admin dashboard', async () => {
    server.use(meHandler(memberUser));
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/requests'));
  });
});

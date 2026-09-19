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
 * login goes to the catalogue, or back to the protected page the user was originally sent from, and
 * an already-authenticated visitor is redirected away from the form.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminUser, errorResponse, meHandler } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { anonymousState, renderApp } from '../../utils/render';
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
  it('redirects to the catalog after a successful login', async () => {
    const user = userEvent.setup();
    server.use(meHandler(adminUser));
    const { router } = renderApp('/login', anonymousState);
    await fillAndSubmit(user, 'Correct-Horse-Battery-9');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeInTheDocument();
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
  it('sends the user home when already signed in', async () => {
    server.use(
      http.get('*/api/assets', () =>
        errorResponse(501, 'NOT_IMPLEMENTED', 'nope', { ticket: 'SCRUM-assets-list' }),
      ),
    );
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

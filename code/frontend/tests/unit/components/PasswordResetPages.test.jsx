// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the forgot-password and reset-password screens, including the no-enumeration confirmation and the token-in-query path
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the two password-reset screens (SCRUM-22).
 *
 * What matters here is mostly what the screens refuse to say. The API answers every
 * forgot-password request identically so that nobody can discover which accounts exist (SR-2), and
 * these tests pin the UI to that: a known address and an unknown one reach the same confirmation,
 * word for word.
 *
 * The reset screen is driven by the `?token=` in the URL, because that is how someone arrives —
 * from a link. The cases worth covering are the ones a real person hits: a mangled link with no
 * token, a mistyped confirmation, a password the API rejects, and a link that has expired.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { VALID_RESET_TOKEN } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { anonymousState, renderApp } from '../../utils/render';

const CONFIRMATION = /a reset link is on its way/i;

/** Fill in the forgot-password form and submit it. */
async function askForLink(user, { org = 'acme-robotics', email = 'ada@acme.test' } = {}) {
  await user.type(screen.getByLabelText('Organization'), org);
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: /email me a reset link/i }));
}

describe('ForgotPasswordPage', () => {
  it('is reachable from the sign-in page', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/login', anonymousState);
    await user.click(screen.getByRole('link', { name: /forgot password/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/forgot-password'));
    expect(screen.getByRole('heading', { level: 1, name: /reset your password/i })).toBeVisible();
  });

  it('confirms in the same words for a known and an unknown account (SR-2)', async () => {
    const user = userEvent.setup();
    renderApp('/forgot-password', anonymousState);
    await askForLink(user, { email: 'ada@acme.test' });
    const known = (await screen.findByRole('status')).textContent;

    // Unmount the first app before mounting the second, or both confirmations share a document and
    // every query below matches twice.
    cleanup();
    renderApp('/forgot-password', anonymousState);
    await askForLink(user, { email: 'nobody@nowhere.test' });
    const unknown = (await screen.findByRole('status')).textContent;

    expect(known).toMatch(CONFIRMATION);
    expect(unknown).toBe(known);
  });

  it('tells the reader how long the link lasts and what to do if it does not arrive', async () => {
    const user = userEvent.setup();
    renderApp('/forgot-password', anonymousState);
    await askForLink(user);
    expect(await screen.findByRole('status')).toHaveTextContent(/10 minutes/i);
    expect(screen.getByText(/ask your organization admin/i)).toBeVisible();
  });

  it('shows an error when the API cannot be reached, and keeps the form', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/auth/forgot-password', () => HttpResponse.error()));
    renderApp('/forgot-password', anonymousState);
    await askForLink(user);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: /email me a reset link/i })).toBeEnabled();
  });
});

describe('ResetPasswordPage', () => {
  it('refuses to show a form when the link carries no token', () => {
    renderApp('/reset-password', anonymousState);
    expect(screen.getByRole('alert')).toHaveTextContent(/link is incomplete/i);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ask for a new link/i })).toBeVisible();
  });

  it('sets the password and sends the user to sign in with a confirmation', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/reset-password?token=${VALID_RESET_TOKEN}`, anonymousState);
    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'A-Brand-New-Passw0rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByRole('status')).toHaveTextContent(/password has been reset/i);
  });

  it('catches a mistyped confirmation without calling the API', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post('*/api/auth/reset-password', () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(`/reset-password?token=${VALID_RESET_TOKEN}`, anonymousState);
    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'A-Brand-New-Passw1rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/both passwords must match/i)).toBeVisible();
    expect(calls).toBe(0);
  });

  it("shows the API's complaint against the password field", async () => {
    const user = userEvent.setup();
    renderApp(`/reset-password?token=${VALID_RESET_TOKEN}`, anonymousState);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/at least 10 characters/i)).toBeVisible();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports an expired or already-used link in the banner, not against a field', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/reset-password?token=stale-token', anonymousState);
    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'A-Brand-New-Passw0rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByRole('alert')).toBeVisible();
    // Still on the page: the person can ask for a fresh link from here.
    expect(router.state.location.pathname).toBe('/reset-password');
  });
});

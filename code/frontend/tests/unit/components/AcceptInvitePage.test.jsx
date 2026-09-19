// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the emailed-invitation request)
// AI-Assisted Areas: tests for the public accept-invitation screen: choosing a password from the emailed link, expired / invalid / missing-token states, success with the organization code
// Human Contributions: pending team review
// Notes: Mounts the real route table and AuthProvider. Must be reviewed by the owning team member before merge.

/**
 * Tests for the accept-invitation screen, reached from the emailed link.
 *
 * They render the real application at `/accept-invite?token=…`, because two things only make sense
 * there: the page must work for someone with **no session** (it is public — the token is the credential),
 * and it must take the token **out of the address bar** so it does not linger in history.
 *
 * The dead-link tests matter as much as the happy path. An invitee who opens a link on day four is the
 * common failure, and what they need to see — "ask your administrator to resend" — is different from what
 * someone who has already used the link needs — "sign in instead". A generic error would serve neither.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorResponse, EXPIRED_TOKEN, memberUser, VALID_TOKEN } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { anonymousState, renderApp } from '../../utils/render';

/** Bodies the page has sent to `POST /api/auth/accept-invite`. */
let bodies;
beforeEach(() => {
  bodies = [];
  server.use(
    http.post('*/api/auth/accept-invite', async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      if (body.token === EXPIRED_TOKEN) {
        return errorResponse(400, 'INVITATION_EXPIRED', 'This invitation has expired');
      }
      if (body.token !== VALID_TOKEN) {
        return errorResponse(400, 'INVITATION_INVALID', 'This invitation link is not valid');
      }
      if (body.password.length < 10) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { location: 'body', path: 'password', message: 'must be at least 10 characters' },
        ]);
      }
      return HttpResponse.json({
        user: { ...memberUser, invitation: null },
        organization: { id: memberUser.orgId, name: 'Acme Robotics', slug: 'acme-robotics' },
      });
    }),
  );
});

/** Open the page as someone with no session, as an invitee clicking the link is. */
const open = (token = VALID_TOKEN) =>
  renderApp(token === null ? '/accept-invite' : `/accept-invite?token=${token}`, anonymousState);

async function fill(user, { password, confirm }) {
  await user.type(screen.getByLabelText('Choose a password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm ?? password);
}

describe('a valid link', () => {
  it('needs no session, and asks for a masked password and its confirmation', () => {
    const { router } = open();
    expect(screen.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible();
    expect(screen.getByLabelText('Choose a password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Choose a password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    // A visitor with no session is not bounced to the login page.
    expect(router.state.location.pathname).toBe('/accept-invite');
  });

  it('tells the invitee that nobody, including whoever invited them, can see the password', () => {
    open();
    expect(screen.getByText(/nobody — including whoever invited you — can see it/i)).toBeVisible();
  });

  it('removes the token from the address bar, so it does not linger in history', async () => {
    const { router } = open();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.pathname).toBe('/accept-invite');
    // …but the form still has it: submitting afterwards still sends it.
    const user = userEvent.setup();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));
    await screen.findByRole('heading', { name: 'You’re all set' });
    expect(bodies[0].token).toBe(VALID_TOKEN);
  });

  it('sends only the token and password, then shows they are signed in and their organization code', async () => {
    const user = userEvent.setup();
    open();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'You’re all set' })).toBeVisible();
    // The confirmation is client-only: the API is never sent it.
    expect(bodies).toEqual([{ token: VALID_TOKEN, password: 'My-Own-Chosen-Passw0rd' }]);
    // Signing in later needs the organization code, which a new member has no other reason to know.
    expect(screen.getByRole('status')).toHaveTextContent('Welcome to Acme Robotics, Max Member');
    expect(screen.getByText('acme-robotics')).toBeVisible();
  });

  it('takes the user into the app from the success screen, already signed in', async () => {
    const user = userEvent.setup();
    const { router } = open();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to SafeDrop' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });

  it('catches a mismatched confirmation locally, spends no token, and keeps what was typed', async () => {
    const user = userEvent.setup();
    open();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd', confirm: 'My-Own-Chosen-Passw0rt' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));

    expect(await screen.findByText('The two passwords do not match.')).toHaveAttribute(
      'id',
      'confirmPassword-error',
    );
    expect(bodies).toEqual([]);
    expect(screen.getByLabelText('Choose a password')).toHaveValue('My-Own-Chosen-Passw0rd');
  });

  it('shows the API’s password rules beside the field, and lets the invitee try again', async () => {
    const user = userEvent.setup();
    open();
    await fill(user, { password: 'short' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));

    expect(await screen.findByText('must be at least 10 characters')).toHaveAttribute(
      'id',
      'password-error',
    );
    const field = screen.getByLabelText('Choose a password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain('password-hint');
    // Still the form, not a dead-link screen: the token was not used up.
    expect(screen.getByRole('button', { name: 'Set password and continue' })).toBeEnabled();
  });

  it('shows an error that belongs to no field as a banner', async () => {
    server.use(http.post('*/api/auth/accept-invite', () => HttpResponse.error()));
    const user = userEvent.setup();
    open();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  });

  it('disables the button while saving', async () => {
    let release;
    server.use(
      http.post('*/api/auth/accept-invite', async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return errorResponse(500, 'INTERNAL_ERROR', 'Boom');
      }),
    );
    const user = userEvent.setup();
    open();
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await screen.findByRole('alert');
  });
});

describe('a link that cannot be used', () => {
  it('explains an expired link and says to ask the administrator, with no form to fill in', async () => {
    const user = userEvent.setup();
    open(EXPIRED_TOKEN);
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invitation has expired' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /ask your administrator to send you a new one/i,
    );
    expect(screen.queryByLabelText('Choose a password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('explains an unknown or already-used link differently, pointing to sign-in', async () => {
    const user = userEvent.setup();
    open('some-other-token-that-matches-nobody-0123456789');
    await fill(user, { password: 'My-Own-Chosen-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invitation link is not valid' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/already been used/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in instead/i);
  });

  it('shows the not-valid page straight away, with no form, when the link has no token', () => {
    open(null);
    expect(
      screen.getByRole('heading', { level: 1, name: 'This invitation link is not valid' }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Choose a password')).not.toBeInTheDocument();
    expect(bodies).toEqual([]);
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the forced change-password screen, the guard that redirects to it, and the admin reset action
// Human Contributions: pending team review
// Notes: Written for SCRUM-22 / SCRUM-36. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for what happens when a password was chosen by somebody else (SCRUM-22, SCRUM-36).
 *
 * Two halves. First, the person on the receiving end: signed in with a password an admin set, they
 * are taken to the change-password screen and kept there until they choose their own. The API is
 * what enforces that — these tests cover the UI half, which exists so the experience is a sentence
 * of explanation rather than a wall of 403s.
 *
 * Second, the admin doing it: a per-row action on the members page that sets a password and says,
 * in the confirmation, what the admin now has to do — pass it on, knowing the member must replace
 * it.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminUser, CURRENT_PASSWORD, meHandler, memberUser } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { authenticatedState, renderApp } from '../../utils/render';

const confined = { ...memberUser, mustChangePassword: true };

describe('a session using a password an admin set', () => {
  it('is taken to the change-password screen from wherever it lands', async () => {
    server.use(meHandler(confined));
    const { router } = renderApp('/requests', authenticatedState(confined));
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
    expect(
      screen.getByRole('heading', { level: 1, name: /choose your own password/i }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/password someone else set/i);
  });

  it('cannot escape by typing another URL', async () => {
    server.use(meHandler(confined));
    const { router } = renderApp('/admin/audit', authenticatedState(confined));
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
  });

  it('is released once a password is chosen, landing on the screen for the role', async () => {
    const user = userEvent.setup();
    // After the change, /me reports the flag cleared — as the real API does.
    server.use(meHandler({ ...memberUser, mustChangePassword: false }));
    const { router } = renderApp('/change-password', authenticatedState(confined));

    await user.type(screen.getByLabelText(/password you were given/i), CURRENT_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'My-Own-Chosen-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'My-Own-Chosen-Passw0rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/requests'));
  });

  it('shows the API’s complaint when the given password is wrong', async () => {
    const user = userEvent.setup();
    server.use(meHandler(confined));
    renderApp('/change-password', authenticatedState(confined));

    await user.type(screen.getByLabelText(/password you were given/i), 'not-the-one');
    await user.type(screen.getByLabelText('New password'), 'My-Own-Chosen-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'My-Own-Chosen-Passw0rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/is incorrect/i)).toBeVisible();
  });

  it('catches a mistyped confirmation before calling the API', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      meHandler(confined),
      http.post('*/api/auth/change-password', () => {
        calls += 1;
        return HttpResponse.json({ user: memberUser });
      }),
    );
    renderApp('/change-password', authenticatedState(confined));

    await user.type(screen.getByLabelText(/password you were given/i), CURRENT_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'My-Own-Chosen-Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'My-Own-Chosen-Passw1rd');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/both passwords must match/i)).toBeVisible();
    expect(calls).toBe(0);
  });

  it('shows the ordinary wording for someone changing a password by choice', async () => {
    renderApp('/change-password', authenticatedState({ ...memberUser, mustChangePassword: false }));
    expect(screen.getByRole('heading', { level: 1, name: /change your password/i })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeVisible();
  });
});

describe('an admin setting a member’s password (SCRUM-36)', () => {
  /** Render the members page as the admin and wait for the table. */
  async function openMembers() {
    // The default handlers already serve GET /api/users from the three fixture members.
    server.use(meHandler(adminUser));
    const utils = renderApp('/admin/users', authenticatedState(adminUser));
    await screen.findByRole('heading', { level: 1, name: /users/i });
    return utils;
  }

  it('offers the action for other people but not for yourself', async () => {
    await openMembers();
    const rows = await screen.findAllByRole('row');
    const adminRow = rows.find((row) => within(row).queryByText(adminUser.email));
    expect(within(adminRow).queryByRole('button', { name: /reset password/i })).toBeNull();

    const otherRow = rows.find((row) => within(row).queryByText(memberUser.email));
    expect(within(otherRow).getByRole('button', { name: /reset password/i })).toBeVisible();
  });

  it('sets a password and explains what the admin must now do', async () => {
    const user = userEvent.setup();
    await openMembers();
    const rows = await screen.findAllByRole('row');
    const otherRow = rows.find((row) => within(row).queryByText(memberUser.email));

    await user.click(within(otherRow).getByRole('button', { name: /reset password/i }));
    await user.type(screen.getByLabelText(/temporary password/i), 'Temp-Passw0rd-123');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/give it to them/i);
    expect(notice).toHaveTextContent(/choose their own/i);
    // The password is never echoed back into the page.
    expect(document.body.textContent).not.toContain('Temp-Passw0rd-123');
  });

  it('reports a password the API rejects against the field', async () => {
    const user = userEvent.setup();
    await openMembers();
    const rows = await screen.findAllByRole('row');
    const otherRow = rows.find((row) => within(row).queryByText(memberUser.email));

    await user.click(within(otherRow).getByRole('button', { name: /reset password/i }));
    await user.type(screen.getByLabelText(/temporary password/i), 'short');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    // Queried by the error element rather than by the text: the invite form's hint on the same
    // page says "At least 10 characters" too.
    const field = screen.getByLabelText(/temporary password/i);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById('reset-password-error')).toHaveTextContent(
      'must be at least 10 characters',
    );
  });
});

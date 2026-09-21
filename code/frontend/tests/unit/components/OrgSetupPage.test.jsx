// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: OrgSetupPage tests: field-level API errors, success adopts the session and lands on the dashboard (SCRUM-100)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the organisation setup page.
 *
 * The distinction under test is how two kinds of failure are presented: a 400 with field details puts
 * each message beside its own input, while a 409 conflict becomes one message at the top of the form.
 * The success path checks that the returned session is adopted directly and the admin lands on the
 * dashboard without a second round trip.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { anonymousState, renderApp } from '../../utils/render';
/**
 * Fill in the four setup fields and submit.
 * @param {object} user a user-event instance
 * @param {string} password the password to type
 * @returns {Promise<void>}
 */
async function fill(user, password) {
  await user.type(screen.getByLabelText('Organization name'), 'Acme Robotics');
  await user.type(screen.getByLabelText('Your name'), 'Ada');
  await user.type(screen.getByLabelText('Your email'), 'ada@acme.test');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create organization' }));
}
describe('OrgSetupPage', () => {
  it('shows field-level errors from the API next to the matching input', async () => {
    const user = userEvent.setup();
    renderApp('/setup', anonymousState);
    await fill(user, 'short');
    const password = screen.getByLabelText('Password');
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('must be at least 10 characters')).toBeInTheDocument();
    expect(password.getAttribute('aria-describedby')).toContain('adminPassword-error');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows a general error for a conflict', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/organizations', () =>
        errorResponse(409, 'CONFLICT', 'An organisation with a similar name already exists'),
      ),
    );
    renderApp('/setup', anonymousState);
    await fill(user, 'Correct-Horse-Battery-9');
    expect(await screen.findByRole('alert')).toHaveTextContent(/similar name/);
  });
  it('creates the organization, adopts the session and lands on the dashboard', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/setup', anonymousState);
    await fill(user, 'Correct-Horse-Battery-9');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
  });
});

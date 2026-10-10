// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-148 story)
// AI-Assisted Areas: OrgSettingsPage tests — current value shown, save sends the new default, errors surfaced
// Human Contributions: story and acceptance criteria by Orelmis Toribio; reviewed and approved by Alex Picard (PR #52, 2026-10-03); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Backend behaviour (403 for non-admins, audit, non-retroactivity) is covered by backend approvalSettings.test.js.

/**
 * Tests for the organisation settings page (SCRUM-148).
 *
 * The page's job is small and easy to get subtly wrong: show the value the organisation actually has,
 * send exactly the one the admin picked, and make the two consequences an admin could be surprised by
 * (not retroactive; still a physical handoff) visible on the screen.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { OrgSettingsPage } from '../../../src/pages/OrgSettingsPage';
import { adminUser, errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

const SETTINGS = '*/api/organizations/me/approval-settings';

describe('OrgSettingsPage (SCRUM-148)', () => {
  it('shows the current default, with Save disabled until something changes', async () => {
    server.use(http.get(SETTINGS, () => HttpResponse.json({ defaultMode: 'AUTO' })));
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByRole('radio', { name: 'Approve automatically' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Require an approver' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('explains that approved items are still handed over in person', async () => {
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });
    const auto = await screen.findByRole('radio', { name: 'Approve automatically' });
    expect(auto).toHaveAccessibleDescription(/still handed over in person/i);
  });

  it('sends the chosen default and says the change is not retroactive', async () => {
    let sent;
    server.use(
      http.patch(SETTINGS, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(sent);
      }),
    );
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    await userEvent.click(await screen.findByRole('radio', { name: 'Approve automatically' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent).toEqual({ defaultMode: 'AUTO' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/requests already waiting stay/i);
    // Saved: nothing left to save until the admin changes it again.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the API error when saving fails, and keeps the choice', async () => {
    server.use(
      http.patch(SETTINGS, () =>
        errorResponse(403, 'FORBIDDEN', 'You do not have permission to do that'),
      ),
    );
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    await userEvent.click(await screen.findByRole('radio', { name: 'Approve automatically' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Approve automatically' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    let calls = 0;
    server.use(
      http.get(SETTINGS, () => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL', 'Something went wrong')
          : HttpResponse.json({ defaultMode: 'REQUIRED' });
      }),
    );
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    await userEvent.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByRole('radio', { name: 'Require an approver' })).toBeChecked();
  });

  it('shows what a request goes through, skipping the decision when approval is automatic', async () => {
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });
    const auto = await screen.findByRole('radio', { name: 'Approve automatically' });
    await userEvent.click(screen.getByRole('radio', { name: 'Require an approver' }));
    const flow = screen.getByRole('list', { name: 'What a request goes through' });
    expect(flow).toHaveTextContent('An approver decides');
    expect(flow).not.toHaveTextContent('(skipped)');
    await userEvent.click(auto);
    expect(flow).toHaveTextContent('An approver decides (skipped)');
  });
});

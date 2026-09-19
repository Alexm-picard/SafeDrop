// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: AdminDashboardPage tests: counts rendered; ErrorState on API failure with retry (SCRUM-103 AC2)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the admin dashboard page.
 *
 * Walks the three states every data-driven screen has: loading, then the counts from the API; an
 * error with a working retry; and the forbidden case, where a non-admin sees the API's rejection
 * rather than an empty dashboard.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AdminDashboardPage } from '../../../src/pages/AdminDashboardPage';
import { adminUser, errorResponse, summary } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';
describe('AdminDashboardPage', () => {
  it('shows a loading state, then the counts from the API', async () => {
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    const grid = await screen.findByRole('list', { name: 'Inventory summary' }).catch(() => null);
    const summaryList = grid ?? (await screen.findByLabelText('Inventory summary'));
    expect(within(summaryList).getByText('Total assets').nextElementSibling).toHaveTextContent(
      String(summary.totalAssets),
    );
    expect(within(summaryList).getByText('Checked out').nextElementSibling).toHaveTextContent(
      String(summary.checkedOut),
    );
    expect(within(summaryList).getByText('Available').nextElementSibling).toHaveTextContent(
      String(summary.available),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('renders ErrorState when the API fails and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/dashboard/summary', () => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json(summary);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the summary');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('INTERNAL_ERROR');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Inventory summary')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
  it('shows a forbidden error for a non-admin the API rejects', async () => {
    server.use(
      http.get('*/api/dashboard/summary', () =>
        errorResponse(403, 'FORBIDDEN', 'You do not have permission to do that'),
      ),
    );
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/);
  });
});

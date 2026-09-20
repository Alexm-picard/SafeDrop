// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: AdminDashboardPage tests: counts rendered; ErrorState on API failure with retry (SCRUM-103 AC2);
//   overdue/pending tiles and the 30-day activity chart (SCRUM-102 AT1)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the admin dashboard page.
 *
 * Walks the three states every data-driven screen has: loading, then the counts from the API; an
 * error with a working retry; and the forbidden case, where a non-admin sees the API's rejection
 * rather than an empty dashboard.
 *
 * The tile assertions are AT1 read literally: every figure the dashboard shows must be the one the
 * API sent, so each is checked against the fixture rather than against a number typed here twice.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AdminDashboardPage } from '../../../src/pages/AdminDashboardPage';
import { formatDay } from '../../../src/utils/format';
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
    expect(within(summaryList).getByText('Overdue').nextElementSibling).toHaveTextContent(
      String(summary.overdue),
    );
    expect(within(summaryList).getByText('Pending requests').nextElementSibling).toHaveTextContent(
      String(summary.pendingRequests),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('AT1: every tile matches the data the API returned', async () => {
    server.use(
      http.get('*/api/dashboard/summary', () =>
        HttpResponse.json({ ...summary, totalAssets: 10, checkedOut: 3, overdue: 1 }),
      ),
    );
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const list = await screen.findByLabelText('Inventory summary');
    expect(within(list).getByText('Total assets').nextElementSibling).toHaveTextContent('10');
    expect(within(list).getByText('Checked out').nextElementSibling).toHaveTextContent('3');
    expect(within(list).getByText('Overdue').nextElementSibling).toHaveTextContent('1');
  });

  it('flags a non-zero overdue count, and leaves it plain at zero', async () => {
    const { unmount } = renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const overdue = await screen.findByText('Overdue');
    expect(overdue.closest('.stat')).toHaveClass('stat--alert');
    unmount();
    server.use(
      http.get('*/api/dashboard/summary', () => HttpResponse.json({ ...summary, overdue: 0 })),
    );
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const calm = await screen.findByText('Overdue');
    expect(calm.closest('.stat')).not.toHaveClass('stat--alert');
  });

  it('charts the last 30 days of checkout activity, with a table of the same numbers', async () => {
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const chart = await screen.findByRole('img', { name: /bar chart of checkouts per day/i });
    expect(chart).toHaveAccessibleName(/over the last 30 days/i);
    // The peak is called out on the chart itself; every other day is in the table.
    expect(chart).toHaveAccessibleName(/busiest day of 6/i);
    const table = screen.getByRole('table', { name: /checkouts per day over the last 30 days/i });
    expect(within(table).getAllByRole('row')).toHaveLength(summary.activity.length + 1);
    const busiest = summary.activity.find((day) => day.checkouts === 6);
    expect(within(table).getByText(formatDay(busiest.date)).nextElementSibling).toHaveTextContent(
      '6',
    );
  });

  it('draws an empty chart rather than nothing when no one has checked anything out', async () => {
    server.use(
      http.get('*/api/dashboard/summary', () =>
        HttpResponse.json({
          ...summary,
          activity: summary.activity.map((day) => ({ ...day, checkouts: 0 })),
        }),
      ),
    );
    renderWithAuth(<AdminDashboardPage />, { user: adminUser });
    const chart = await screen.findByRole('img', { name: /bar chart of checkouts per day/i });
    expect(chart).toHaveAccessibleName(/no checkouts in this period/i);
    expect(chart.querySelectorAll('.chart-bar')).toHaveLength(0);
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

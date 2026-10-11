// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the admin AI search page: status line, daily trend, figures, fallback reasons, catalog size (SCRUM-242, OD-10)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: Every figure is checked against the fixture the API mock returns, as in AdminDashboardPage.test.jsx.

/**
 * Tests for the AI search page (SCRUM-242).
 *
 * The page turns `GET /api/search-telemetry` into a status line, a daily chart stacked by outcome,
 * four figures, the reasons searches fell back, and a note on catalog size. Each test pins one of
 * those to the API's numbers. The status wording itself is `aiSearchStatus`'s, tested on its own in
 * aiSearchStatus.test.js; here it is only checked that the page shows it.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AiSearchPage } from '../../../src/pages/AiSearchPage';
import { formatDay } from '../../../src/utils/format';
import {
  adminUser,
  errorResponse,
  searchTelemetryDaily,
  searchTelemetrySummary,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

const renderPage = () => renderWithAuth(<AiSearchPage />, { user: adminUser });

/** Answer the telemetry call with the fixture, changed by `overrides`. */
function telemetry(overrides) {
  server.use(
    http.get('*/api/search-telemetry', () =>
      HttpResponse.json({ ...searchTelemetrySummary, ...overrides }),
    ),
  );
}

/** The headline figure labelled `label`. */
async function figure(label) {
  const list = await screen.findByLabelText('AI search summary', { selector: 'dl' });
  return within(list).getByText(label).closest('.stat');
}

describe('AiSearchPage', () => {
  it('leads with the status, in plain words', async () => {
    renderPage();

    expect(await screen.findByText('AI search is working normally')).toBeVisible();
    expect(
      screen.getByText('38 of 41 searches in the last 30 days were ranked by AI.'),
    ).toBeVisible();
  });

  it('shows the headline figures the API returned', async () => {
    renderPage();

    expect(await figure('Searches')).toHaveTextContent('41');
    const ranked = await figure('Ranked by AI');
    expect(ranked).toHaveTextContent('93%');
    expect(ranked).toHaveTextContent('38 of 41');
    const wait = await figure('Typical wait');
    expect(wait).toHaveTextContent('4.6 s');
    expect(wait).toHaveTextContent('95% within 6.9 s');
    const none = await figure('No results');
    expect(none).toHaveTextContent('5%');
    expect(none).toHaveTextContent('2 searches');
  });

  it('charts every day by outcome, with a legend and a table of the same numbers', async () => {
    renderPage();

    const chart = await screen.findByRole('region', { name: 'Searches per day' });
    expect(
      within(chart).getByText('Ranked by AI', { selector: '.chart-legend li' }),
    ).toBeInTheDocument();
    expect(
      within(chart).getByText('Fell back to text matching', { selector: '.chart-legend li' }),
    ).toBeInTheDocument();
    // The table is the chart for anyone who cannot see it: one row per day, both outcomes.
    const table = within(chart).getByRole('table', { name: 'Searches per day by outcome' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(searchTelemetryDaily.length);
    const day = searchTelemetryDaily[20];
    const row = within(table)
      .getByRole('rowheader', { name: formatDay(day.date) })
      .closest('tr');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([String(day.aiAssisted), String(day.fallback)]);
  });

  it('lists only the reasons searches actually fell back for, in plain words', async () => {
    renderPage();

    const reasons = await screen.findByLabelText('Fallback reasons', { selector: 'dl' });
    expect(
      within(reasons).getByText("The AI service didn't respond").nextElementSibling,
    ).toHaveTextContent('2 searches');
    expect(
      within(reasons).getByText("The AI's answer couldn't be used").nextElementSibling,
    ).toHaveTextContent('1 search');
    // None were switched off, so that reason is not listed at all.
    expect(within(reasons).queryByText('AI search was switched off')).not.toBeInTheDocument();
  });

  it('leaves out the fallback section in a month with no fallbacks', async () => {
    telemetry({ aiAssisted: 41, fallbacks: { disabled: 0, unavailable: 0, contract: 0 } });
    renderPage();

    await screen.findByText('AI search is working normally');
    expect(
      screen.queryByRole('heading', { name: 'Why searches fell back' }),
    ).not.toBeInTheDocument();
  });

  it('says the whole catalog was considered while no search reached the limit', async () => {
    renderPage();

    expect(await screen.findByText(/every search considered your whole catalog/)).toHaveTextContent(
      'up to 100 items',
    );
  });

  it('keeps the catalog warning when the status line is about failures (OD-10)', async () => {
    telemetry({
      aiAssisted: 30,
      fallbacks: { disabled: 0, unavailable: 8, contract: 3 },
      candidateCapHits: 4,
    });
    renderPage();

    expect(
      await screen.findByText('AI search is often falling back to text matching'),
    ).toBeVisible();
    expect(screen.getByText(/4 searches reached the 100-item limit/)).toBeVisible();
  });

  it('shows only the status when nobody has searched', async () => {
    telemetry({
      total: 0,
      aiAssisted: 0,
      fallbacks: { disabled: 0, unavailable: 0, contract: 0 },
      fallbackRate: null,
      zeroResults: 0,
      zeroResultRate: null,
      latencyMs: { avg: null, p50: null, p95: null, max: null },
      daily: searchTelemetryDaily.map((day) => ({ ...day, aiAssisted: 0, fallback: 0 })),
    });
    renderPage();

    expect(await screen.findByText('No searches yet')).toBeVisible();
    expect(screen.queryByLabelText('AI search summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Searches per day' })).not.toBeInTheDocument();
  });

  it('skips the chart, not the page, when the range was too long for a daily series', async () => {
    telemetry({ daily: null });
    renderPage();

    expect(await figure('Searches')).toHaveTextContent('41');
    expect(screen.queryByRole('region', { name: 'Searches per day' })).not.toBeInTheDocument();
  });

  it('renders ErrorState when the API fails and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/search-telemetry', () => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json(searchTelemetrySummary);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load AI search figures');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await figure('Searches')).toHaveTextContent('41');
    expect(calls).toBe(2);
  });
});

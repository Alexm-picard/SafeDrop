// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the dashboard's AI search card (SCRUM-206 AT-4, OD-10)
// Human Contributions: feature choice and scope by Amber Rastella; reviewer recorded on the PR
// Notes: Every figure is checked against the fixture the API mock returns, as in AdminDashboardPage.test.jsx.

/**
 * Tests for the AI search card on the admin dashboard.
 *
 * The card turns `GET /api/search-telemetry` into four figures, an outcome bar with its legend, and a
 * note on whether the catalogue outgrew the model's candidate cap. Each test pins one of those to the
 * API's numbers, plus the states a secondary panel needs: nothing to show yet, and a failure that
 * stays quiet and can be retried.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AiSearchHealth } from '../../../src/components/AiSearchHealth';
import { adminUser, errorResponse, searchTelemetrySummary } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

const renderCard = () => renderWithAuth(<AiSearchHealth />, { user: adminUser });

/** Answer the telemetry call with the fixture, changed by `overrides`. */
function telemetry(overrides) {
  server.use(
    http.get('*/api/search-telemetry', () =>
      HttpResponse.json({ ...searchTelemetrySummary, ...overrides }),
    ),
  );
}

/** The value shown for `label` in the list named `listName`. */
async function figure(listName, label) {
  const list = await screen.findByLabelText(listName, { selector: 'dl' });
  return within(list).getByText(label).closest('.stat');
}

describe('AiSearchHealth', () => {
  it('shows the headline figures the API returned', async () => {
    renderCard();

    expect(await figure('AI search summary', 'Searches')).toHaveTextContent('40');
    // 30 of 40 ranked by the model.
    const ranked = await figure('AI search summary', 'Ranked by AI');
    expect(ranked).toHaveTextContent('75%');
    expect(ranked).toHaveTextContent('30 of 40');
    // Latency is shown in seconds: p50 as the headline, p95 as the detail.
    const wait = await figure('AI search summary', 'Typical wait');
    expect(wait).toHaveTextContent('4.6 s');
    expect(wait).toHaveTextContent('95% within 6.9 s');
    const none = await figure('AI search summary', 'No results');
    expect(none).toHaveTextContent('5%');
    expect(none).toHaveTextContent('2 searches');
  });

  it('accounts for every search in the outcome legend, fallbacks told apart', async () => {
    renderCard();

    const legend = await screen.findByLabelText('Search outcomes', { selector: 'dl' });
    const count = (label) => within(legend).getByText(label).closest('.stat').querySelector('dd');
    expect(count('Ranked by AI')).toHaveTextContent('30');
    expect(count('AI switched off')).toHaveTextContent('0');
    expect(count('AI unavailable')).toHaveTextContent('6');
    expect(count('Unusable AI answer')).toHaveTextContent('4');
    // The four outcomes are exhaustive: they add up to the total.
    const sum = ['Ranked by AI', 'AI switched off', 'AI unavailable', 'Unusable AI answer']
      .map((label) => Number(count(label).textContent))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(searchTelemetrySummary.total);
  });

  it('says the whole catalog was considered while no search reached the candidate cap', async () => {
    renderCard();

    expect(await screen.findByText(/Every search considered your whole catalog/)).toHaveTextContent(
      'up to 100 items',
    );
  });

  it('warns when searches reached the candidate cap (OD-10)', async () => {
    telemetry({ candidateCapHits: 3 });
    renderCard();

    expect(await screen.findByText(/3 searches reached the 100-item limit/)).toHaveTextContent(
      'the AI considered only part of your catalog',
    );
    expect(screen.queryByText(/Every search considered/)).not.toBeInTheDocument();
  });

  it('shows a plain note, not zeros and dashes, when nobody has searched', async () => {
    telemetry({
      total: 0,
      aiAssisted: 0,
      fallbacks: { disabled: 0, unavailable: 0, contract: 0 },
      fallbackRate: null,
      zeroResults: 0,
      zeroResultRate: null,
      latencyMs: { avg: null, p50: null, p95: null, max: null },
    });
    renderCard();

    expect(await screen.findByText(/No searches in the last 30 days/)).toBeVisible();
    expect(screen.queryByLabelText('AI search summary')).not.toBeInTheDocument();
  });

  it('fails quietly, without an alert, and loads on retry', async () => {
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
    renderCard();

    expect(await screen.findByText('The AI search figures could not be loaded.')).toBeVisible();
    // A secondary panel never raises the page's alert: the dashboard's own figures own that.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await figure('AI search summary', 'Searches')).toHaveTextContent('40');
    expect(calls).toBe(2);
  });
});

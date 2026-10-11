// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the Overview's AI search notice (SCRUM-242)
// Human Contributions: feature choice and placement by Amber Rastella; reviewer recorded on the PR
// Notes: The notice's wording comes from aiSearchStatus, tested in aiSearchStatus.test.js.

/**
 * Tests for `AiSearchAlert`, the Overview's only trace of AI search: silent unless something needs
 * the admin, then a notice linking to the AI search page (SCRUM-242).
 */
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AiSearchAlert } from '../../../src/components/AiSearchAlert';
import { adminUser, errorResponse, searchTelemetrySummary } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/**
 * Render the alert with the telemetry call answered by `respond`, and wait until it has been answered,
 * so a test asserting that nothing rendered is not passing merely because nothing has arrived yet.
 */
async function renderAlert(respond = () => HttpResponse.json(searchTelemetrySummary)) {
  let answered;
  const done = new Promise((resolve) => {
    answered = resolve;
  });
  server.use(
    http.get('*/api/search-telemetry', () => {
      answered();
      return respond();
    }),
  );
  const view = renderWithAuth(<AiSearchAlert />, { user: adminUser });
  await done;
  // One more tick for React to render whatever the answer produced.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return view;
}

describe('AiSearchAlert', () => {
  it('renders nothing while AI search is working normally', async () => {
    const { container } = await renderAlert();

    expect(container).toBeEmptyDOMElement();
  });

  it('links to the AI search page when searches keep falling back', async () => {
    await renderAlert(() =>
      HttpResponse.json({
        ...searchTelemetrySummary,
        aiAssisted: 30,
        fallbacks: { disabled: 0, unavailable: 8, contract: 3 },
      }),
    );

    expect(
      await screen.findByText('AI search is often falling back to text matching.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'View AI search' })).toHaveAttribute(
      'href',
      '/admin/ai-search',
    );
  });

  it('stays silent when the figures fail to load, rather than adding an error to the Overview', async () => {
    const { container } = await renderAlert(() =>
      errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong'),
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

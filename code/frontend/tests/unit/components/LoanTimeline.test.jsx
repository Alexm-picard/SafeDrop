// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: LoanTimeline tests (SCRUM-241): which requests it draws, how a late loan reads, and that every row is a labelled link
// Human Contributions: pending team review

/**
 * Tests for the overview's loan timeline.
 *
 * The bars are decoration; what a test can hold the timeline to is which requests it shows, that each
 * row is a link to its request named in words (asset, unit, state, dates), and that a late loan says
 * how late in text rather than only by colour and length.
 */
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { LoanTimeline } from '../../../src/components/LoanTimeline';
import { adminUser, daysFromNow, requestsPage } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** Serve exactly `items` as the organisation's requests. */
const serve = (items) =>
  server.use(
    http.get('*/api/requests', () =>
      HttpResponse.json({ items, total: items.length, page: 1, limit: 100 }),
    ),
  );

const base = requestsPage(new URLSearchParams()).items;
const byState = (state) => base.find((r) => r.state === state);

describe('LoanTimeline', () => {
  it('draws the live requests as links to them, and leaves denied ones off', async () => {
    renderWithAuth(<LoanTimeline />, { user: adminUser });
    const list = await screen.findByRole('list');
    const links = within(list).getAllByRole('link');
    // The fixture has one each of pending, approved, checked out and denied: three are live.
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/requests\/.+/));
    }
    expect(screen.queryByRole('link', { name: /Denied/ })).not.toBeInTheDocument();
  });

  it('names each row in words: asset, requester, state and dates', async () => {
    serve([byState('PENDING')]);
    renderWithAuth(<LoanTimeline />, { user: adminUser });
    const link = await screen.findByRole('link', { name: /Pending/ });
    expect(link).toHaveAccessibleName(new RegExp(byState('PENDING').asset.name));
    expect(link).toHaveAccessibleName(/Oct 1 to Oct 15/);
  });

  it('says how late an overdue loan is, in words', async () => {
    serve([{ ...byState('CHECKED_OUT'), dueAt: daysFromNow(-4) }]);
    renderWithAuth(<LoanTimeline />, { user: adminUser });
    expect(await screen.findByRole('link', { name: /Overdue by 4 days/ })).toBeInTheDocument();
  });

  it('says so when nothing is live', async () => {
    serve([byState('DENIED')]);
    renderWithAuth(<LoanTimeline />, { user: adminUser });
    expect(
      await screen.findByText('Nothing is waiting, on hold or out on loan right now.'),
    ).toBeInTheDocument();
  });

  it('links to the requests board for everything else', async () => {
    renderWithAuth(<LoanTimeline />, { user: adminUser });
    expect(screen.getByRole('link', { name: 'Open the requests board' })).toHaveAttribute(
      'href',
      '/admin/approvals',
    );
  });
});

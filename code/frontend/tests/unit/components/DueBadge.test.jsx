// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-143 ticket)
// AI-Assisted Areas: tests for the due badge on the two screens that show it — the Due column on my
// requests, the badge beside the due date on request detail, and the requirement that colour is
// never the only thing carrying the message
// Human Contributions: reviewed and approved by Amber Rastella (PR #48, 2026-09-28); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written test-first for SCRUM-143 (Lab 3, TDD). Written and watched to fail before either
// page rendered a badge. Reviewed before merge; see Human Contributions.

/**
 * The due badge, on the two screens that show it (SCRUM-143).
 *
 * The arithmetic is tested directly in `tests/unit/utils/dueStatus.test.js`; what is left for these
 * is what the pure function cannot answer — whether the badge reaches the screen, on which rows, and
 * whether it is readable once it gets there. They are in one feature file rather than split between
 * `RequestCreation.test.jsx` (where MyRequestsPage's tests live) and `RequestDetailPage.test.jsx`,
 * because the badge is one feature and a reviewer should be able to read it in one place.
 *
 * Two things are worth calling out:
 *
 *  - **The rows without a badge matter as much as the row with one.** A column that shows something
 *    on every row would pass a test that only looked at the checked-out row, and would be wrong: a
 *    pending request has no deadline to report.
 *  - **The badge says what it means in words.** Colour alone fails anyone who cannot see the
 *    difference between the green one and the red one (WCAG 1.4.1), so the tone is a `data-tone`
 *    attribute for the stylesheet to key off and the text carries the message on its own.
 *
 * The fixture's checked-out request is due in three days, relative to whenever the suite runs — see
 * `daysFromNow` in `tests/mocks/handlers.js`.
 */
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { MyRequestsPage } from '../../../src/pages/MyRequestsPage';
import { checkoutRequests, daysFromNow, meHandler, memberUser } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { authenticatedState, renderApp, renderWithAuth } from '../../utils/render';

const checkedOut = checkoutRequests.find((r) => r.state === 'CHECKED_OUT');
const approved = checkoutRequests.find((r) => r.state === 'APPROVED');

/** Mount the member's own requests and wait for the board to arrive. */
async function renderMyRequests() {
  const utils = renderWithAuth(<MyRequestsPage />, { user: memberUser });
  await screen.findByRole('region', { name: 'Out on loan' });
  return utils;
}

/**
 * The board card for a request, found by the state badge it carries.
 *
 * By the state rather than by index, so a fixture reordered later moves these tests' subject with it
 * instead of quietly pointing them at the wrong card.
 * @param {string} state the humanised state, as the card's badge renders it
 * @returns {HTMLElement|undefined}
 */
function rowFor(state) {
  return screen
    .getAllByRole('listitem')
    .find((card) => within(card).queryByText(state, { exact: true }));
}

/** Open one request's detail screen as `user`, waiting for it to settle. */
async function openRequest(request, user = memberUser) {
  server.use(meHandler(user));
  const utils = renderApp(`/requests/${request.id}`, authenticatedState(user));
  await screen.findByRole('heading', { level: 2, name: 'Actions' });
  return utils;
}

describe('the due badge on my requests', () => {
  it('has a column for loans, where the badge lives', async () => {
    await renderMyRequests();

    expect(screen.getByRole('region', { name: 'Out on loan' })).toBeVisible();
  });

  it('badges the checked-out row with how long is left', async () => {
    await renderMyRequests();

    expect(within(rowFor('Checked out')).getByText('Due in 3 days')).toBeVisible();
  });

  it('says nothing on rows that are not out on loan', async () => {
    await renderMyRequests();

    // What the badge must not do is invent a deadline for a request that has not been handed over.
    expect(rowFor('Pending')).not.toHaveTextContent(/Due|Overdue/);
    expect(rowFor('Approved')).not.toHaveTextContent(/Due|Overdue/);
    expect(rowFor('Denied')).not.toHaveTextContent(/Due|Overdue/);
  });

  it('says a late row is late, in words and not only in colour', async () => {
    server.use(
      http.get('*/api/requests', () =>
        HttpResponse.json({
          items: [{ ...checkedOut, dueAt: daysFromNow(-2) }],
          total: 1,
          page: 1,
          limit: 25,
        }),
      ),
    );
    await renderMyRequests();

    const badge = within(rowFor('Checked out')).getByText('Overdue by 2 days');
    expect(badge).toBeVisible();
    // The text is the whole message: with every stylesheet stripped away, the row still says it is
    // two days late. This is the assertion that stops the badge becoming a coloured dot.
    expect(badge).toHaveTextContent('Overdue by 2 days');
  });

  it('exposes the tone as an attribute, for the stylesheet rather than for the reader', async () => {
    await renderMyRequests();

    // `data-tone` rather than a class name, so the styling hook is explicit and a test can assert on
    // it without pinning down what the stylesheet happens to call its colours this week.
    expect(within(rowFor('Checked out')).getByText('Due in 3 days')).toHaveAttribute(
      'data-tone',
      'ok',
    );
  });
});

describe('the due badge on request detail', () => {
  it('sits beside the due date it describes', async () => {
    await openRequest(checkedOut);

    // Scoped to the details list: the badge belongs next to "Due back", not loose on the page.
    const details = screen.getByLabelText('Request details');
    expect(within(details).getByText('Due back')).toBeVisible();
    expect(within(details).getByText('Due in 3 days')).toBeVisible();
  });

  it('leaves a request that is not out on loan without one', async () => {
    // APPROVED: decided, but not yet handed over, so there is no deadline to describe.
    await openRequest(approved);

    const details = screen.getByLabelText('Request details');
    expect(within(details).queryByText(/^(Due (in|today|tomorrow)|Overdue)/)).toBeNull();
  });

  it('shows the same words as the list does for the same request', async () => {
    // The two screens share one function, and this is the test that would catch them drifting apart
    // — a detail page that rounded differently from the row the member clicked to reach it.
    await openRequest(checkedOut);

    const details = screen.getByLabelText('Request details');
    const badge = within(details).getByText('Due in 3 days');
    expect(badge).toHaveAttribute('data-tone', 'ok');
  });
});

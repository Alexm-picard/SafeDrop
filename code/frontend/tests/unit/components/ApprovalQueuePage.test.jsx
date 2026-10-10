// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: ApprovalQueuePage tests — loading, the state filter, each row linking to its detail page, errors; SCRUM-241 redesign: the board, its cards and their one-click actions
// Human Contributions: reviewed and merged by Mateus Silva (PR #18, 2026-09-19); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

/**
 * Tests for the approval queue (SCRUM-119, SCRUM-120, SCRUM-205).
 *
 * Covers what the page actually does: defaults to All, filters by state, links every card to the
 * request's detail page (where the steps that need a condition or a reason live — see
 * RequestDetailPage.test.jsx and CustodyConfirmation.test.jsx), offers the one-click steps on the card,
 * and surfaces a failed load with a working retry.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApprovalQueuePage } from '../../../src/pages/ApprovalQueuePage';
import {
  approverUser,
  assets,
  errorResponse,
  memberUser,
  requestsPage,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { REQUEST_STATES } from '../../../src/utils/constants';
import { renderWithAuth } from '../../utils/render';

/** The board under its heading, which names the current view ("All requests", "Returned"…). */
const board = (name = 'All requests') => screen.findByRole('region', { name });
/** The request cards on the board. */
const cardsIn = (region) => within(region).getAllByRole('listitem');

describe('ApprovalQueuePage', () => {
  it('defaults to All and asks for the organisation-wide view', async () => {
    const seen = [];
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search);
        return HttpResponse.json(requestsPage(search));
      }),
    );
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(cardsIn(await board())).toHaveLength(4);
    expect(seen[0].get('scope')).toBe('org');
    expect(seen[0].has('state')).toBe(false);
  });

  it('links every card to its request detail page and offers only the one-click steps', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const region = await board();
    const cards = cardsIn(region);
    for (const card of cards) {
      expect(within(card).getAllByRole('link')[0]).toHaveAttribute(
        'href',
        expect.stringMatching(/^\/requests\/.+/),
      );
    }
    // PENDING: approve or deny. APPROVED: record the handoff. A return needs a condition, so it
    // stays on the request page; a denied request has nothing to do.
    expect(within(region).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Record handoff' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Record return' })).not.toBeInTheDocument();
  });

  it('approves from the card, says so and reloads the board', async () => {
    let loads = 0;
    server.use(
      http.get('*/api/requests', ({ request }) => {
        loads += 1;
        return HttpResponse.json(requestsPage(new URL(request.url).searchParams));
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const region = await board();
    await user.click(within(region).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`Approved. ${assets[0].name}`);
    await waitFor(() => expect(loads).toBe(2));
  });

  it('puts each request in the column for its stage', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await board();
    const column = (name) => screen.getByRole('region', { name });
    expect(cardsIn(column('Waiting for a decision'))).toHaveLength(1);
    expect(cardsIn(column('Ready for pickup'))).toHaveLength(1);
    expect(cardsIn(column('Out on loan'))).toHaveLength(1);
    expect(cardsIn(column('Done'))).toHaveLength(1);
  });

  it('can list returns waiting to be confirmed', async () => {
    const seen = [];
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search);
        return HttpResponse.json(requestsPage(search));
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await board();
    await user.click(screen.getByRole('button', { name: 'Return pending' }));
    await waitFor(() => expect(seen.at(-1).get('state')).toBe('RETURN_PENDING'));
  });

  it('names the requester, the asset and the unit tag rather than raw ids', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const [card] = cardsIn(await board());
    expect(within(card).getByText(memberUser.name)).toBeInTheDocument();
    expect(within(card).getByText(memberUser.email)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: new RegExp(assets[0].name) })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/requests\//),
    );
    expect(within(card).getByRole('link', { name: 'View asset' })).toHaveAttribute(
      'href',
      `/assets/${assets[0].id}`,
    );
    expect(within(card).queryByText(memberUser.id)).not.toBeInTheDocument();
  });

  it('opens on the state named in the URL, so the dashboard can link straight to a view', async () => {
    const seen = [];
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search);
        return HttpResponse.json(requestsPage(search));
      }),
    );
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser, route: '/?state=CHECKED_OUT' });
    expect(screen.getByRole('button', { name: 'Checked out' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await board('Checked out');
    expect(seen[0].get('state')).toBe('CHECKED_OUT');
  });

  it('offers a button for every request state, plus All', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const group = screen.getByRole('list', { name: 'State' });
    expect(within(group).getAllByRole('button')).toHaveLength(REQUEST_STATES.length + 1);
  });

  it('asks for late loans, not just the OVERDUE state, so it matches the dashboard count', async () => {
    const seen = [];
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search);
        return HttpResponse.json(requestsPage(search));
      }),
    );
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser, route: '/?state=OVERDUE' });
    await screen.findByText('No requests match this filter.');
    expect(seen[0].get('overdue')).toBe('true');
    expect(seen[0].has('state')).toBe(false);
  });

  it('switches view from a filter button', async () => {
    const user = userEvent.setup();
    const { router } = renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await board();
    await user.click(screen.getByRole('button', { name: 'Approved' }));
    expect(screen.getByRole('button', { name: 'Approved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(router.state.location.search).toBe('?state=APPROVED');
  });

  it('renders ErrorState when the initial load fails and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/requests', ({ request }) => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json(requestsPage(new URL(request.url).searchParams));
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the queue');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await board()).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('does not navigate when the filter form is submitted', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await board();
    // Filters apply as they change, so a submit has nothing to do; letting it through would reload
    // the SPA and throw away the session bootstrap.
    const form = screen.getByRole('form', { name: 'Filter requests' });
    expect(fireEvent.submit(form)).toBe(false);
  });
});

describe('ApprovalQueuePage cards and labels (UI rework)', () => {
  /** Serve exactly `items` as the queue, whatever the filter. */
  const serve = (items) =>
    server.use(
      http.get('*/api/requests', () =>
        HttpResponse.json({ items, total: items.length, page: 1, limit: 25 }),
      ),
    );
  const base = requestsPage(new URLSearchParams()).items[0];

  it('says "Unknown" rather than leaving a blank when the requester or asset no longer resolves', async () => {
    serve([{ ...base, requester: null, asset: null, unit: null }]);
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const region = await board();
    expect(within(region).getByText('Unknown user')).toBeInTheDocument();
    expect(within(region).getByText('Unknown asset')).toBeInTheDocument();
    expect(region.querySelector('.tag')).toBeNull();
  });

  it('marks an auto-approved request as automatic', async () => {
    serve([{ ...base, state: 'APPROVED', autoApproved: true }]);
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const region = await board();
    expect(within(region).getByText('Approved (automatic)')).toBeInTheDocument();
  });

  it('counts the rows itself when the response has no total', async () => {
    server.use(
      http.get('*/api/requests', () =>
        HttpResponse.json({ items: [base, { ...base, id: 'other' }], page: 1, limit: 25 }),
      ),
    );
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    expect(await screen.findByText('2 requests')).toBeInTheDocument();
  });

  it('heads the list with the state name for a state that has a button, and "All requests" for All', async () => {
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser, route: '/?state=RETURNED' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Returned' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'All requests' }),
    ).toBeInTheDocument();
  });

  it('treats an empty ?state= as All', async () => {
    const seen = [];
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search);
        return HttpResponse.json(requestsPage(search));
      }),
    );
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser, route: '/?state=' });
    await board();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(seen[0].has('state')).toBe(false);
  });
});

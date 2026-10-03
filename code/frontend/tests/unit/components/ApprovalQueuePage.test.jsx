// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: ApprovalQueuePage tests — loading, the state filter, each row linking to its detail page, errors
// Human Contributions: pending team review

/**
 * Tests for the approval queue (SCRUM-119, SCRUM-120, SCRUM-205).
 *
 * Covers what the page actually does: defaults to All, filters by state, links every row to the
 * request's detail page (where the actions live — see RequestDetailPage.test.jsx and
 * CustodyConfirmation.test.jsx), and surfaces a failed load with a working retry.
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
    const table = await screen.findByRole('table', { name: 'Requests' });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4);
    expect(seen[0].get('scope')).toBe('org');
    expect(seen[0].has('state')).toBe(false);
  });

  it('links every row to its request detail page and offers no actions of its own', async () => {
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await screen.findByRole('table', { name: 'Requests' });
    await user.click(screen.getByRole('button', { name: 'All' }));
    const table = await screen.findByRole('table', { name: 'Requests' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(1);
    expect(within(table).getAllByRole('link', { name: 'Open' })).toHaveLength(rows.length);
    expect(within(table).getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/requests\/.+/),
    );
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
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
    await screen.findByRole('table', { name: 'Requests' });
    await user.click(screen.getByRole('button', { name: 'Return pending' }));
    await waitFor(() => expect(seen.at(-1).get('state')).toBe('RETURN_PENDING'));
  });

  it('names the requester, the asset and the unit tag rather than raw ids', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const table = await screen.findByRole('table', { name: 'Requests' });
    const [row] = within(table).getAllByRole('row').slice(1);
    expect(within(row).getByText(memberUser.name)).toBeInTheDocument();
    expect(within(row).getByText(memberUser.email)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: assets[0].name })).toHaveAttribute(
      'href',
      `/assets/${assets[0].id}`,
    );
    expect(within(row).queryByText(memberUser.id)).not.toBeInTheDocument();
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
    await screen.findByRole('table', { name: 'Requests' });
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
    await screen.findByRole('table', { name: 'Requests' });
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
    expect(await screen.findByRole('table', { name: 'Requests' })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('does not navigate when the filter form is submitted', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await screen.findByRole('table', { name: 'Requests' });
    // Filters apply as they change, so a submit has nothing to do; letting it through would reload
    // the SPA and throw away the session bootstrap.
    const form = screen.getByRole('form', { name: 'Filter requests' });
    expect(fireEvent.submit(form)).toBe(false);
  });
});

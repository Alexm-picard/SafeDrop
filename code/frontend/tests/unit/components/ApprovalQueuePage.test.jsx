// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: ApprovalQueuePage tests — loading, the state filter, approve/deny/checkout/return actions and their errors
// Human Contributions: pending team review

/**
 * Tests for the approval queue (SCRUM-requests-approve, SCRUM-requests-deny,
 * SCRUM-requests-checkout, SCRUM-requests-return, SCRUM-requests-list).
 *
 * Covers what the page actually does: defaults to PENDING, shows only the action a row's own state
 * allows, reloads after a successful action, and surfaces (with a working retry that replays the
 * exact same action and payload) one that fails.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApprovalQueuePage } from '../../../src/pages/ApprovalQueuePage';
import { approverUser, checkoutRequests, errorResponse, requestsPage } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

describe('ApprovalQueuePage', () => {
  it('defaults to PENDING and shows Approve/Deny only for the pending request', async () => {
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    expect(screen.getByLabelText('State')).toHaveValue('PENDING');
    const table = await screen.findByRole('table', { name: 'Requests' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(table).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('shows no actions for a state with none defined', async () => {
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await screen.findByRole('table', { name: 'Requests' });
    await user.selectOptions(screen.getByLabelText('State'), 'DENIED');
    const table = await screen.findByRole('table', { name: 'Requests' });
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('approving removes the request from the PENDING view and reloads', async () => {
    let listCalls = 0;
    server.use(
      http.get('*/api/requests', ({ request }) => {
        listCalls += 1;
        if (listCalls === 1) {
          return HttpResponse.json(requestsPage(new URL(request.url).searchParams));
        }
        return HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.click(within(table).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('No requests match this filter.')).toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it('denying removes the request from the PENDING view and reloads', async () => {
    let listCalls = 0;
    server.use(
      http.get('*/api/requests', ({ request }) => {
        listCalls += 1;
        if (listCalls === 1) {
          return HttpResponse.json(requestsPage(new URL(request.url).searchParams));
        }
        return HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.click(within(table).getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('No requests match this filter.')).toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it('shows an error and lets a failed decision be retried', async () => {
    let approveCalls = 0;
    server.use(
      http.post('*/api/requests/:id/approve', () => {
        approveCalls += 1;
        return approveCalls === 1
          ? errorResponse(403, 'FORBIDDEN', 'Not allowed to decide this request')
          : HttpResponse.json({ ...checkoutRequests[0], state: 'APPROVED' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.click(within(table).getByRole('button', { name: 'Approve' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not complete that action');
    expect(alert).toHaveTextContent('FORBIDDEN');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(approveCalls).toBe(2);
  });

  it('shows a Check out button for an APPROVED row, and checking out reloads the list', async () => {
    let checkedOut = false;
    server.use(
      http.get('*/api/requests', ({ request }) => {
        const search = new URL(request.url).searchParams;
        if (search.get('state') === 'APPROVED' && checkedOut) {
          return HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 });
        }
        return HttpResponse.json(requestsPage(search));
      }),
      http.post('*/api/requests/:id/checkout', ({ params }) => {
        checkedOut = true;
        const found = checkoutRequests.find((r) => r.id === params.id);
        return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'CHECKED_OUT' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'APPROVED');
    const table = await screen.findByRole('table', { name: 'Requests' });
    expect(within(table).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('No requests match this filter.')).toBeInTheDocument();
  });

  it('shows an error and lets a failed checkout be retried', async () => {
    let checkoutCalls = 0;
    server.use(
      http.post('*/api/requests/:id/checkout', () => {
        checkoutCalls += 1;
        return checkoutCalls === 1
          ? errorResponse(409, 'INVALID_STATE_TRANSITION', 'Request is not APPROVED')
          : HttpResponse.json({ ...checkoutRequests[1], state: 'CHECKED_OUT' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'APPROVED');
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.click(within(table).getByRole('button', { name: 'Check out' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not complete that action');
    expect(alert).toHaveTextContent('INVALID_STATE_TRANSITION');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(checkoutCalls).toBe(2);
  });

  it('shows a Return button and a condition selector for a CHECKED_OUT row', async () => {
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'CHECKED_OUT');
    const table = await screen.findByRole('table', { name: 'Requests' });
    expect(within(table).getByLabelText('Returned condition')).toHaveValue('');
    expect(within(table).getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });

  it('returning with a chosen condition sends it in the request body', async () => {
    let receivedBody;
    server.use(
      http.post('*/api/requests/:id/return', async ({ request, params }) => {
        receivedBody = await request.json();
        const found = checkoutRequests.find((r) => r.id === params.id);
        return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'RETURNED' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'CHECKED_OUT');
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.selectOptions(within(table).getByLabelText('Returned condition'), 'FAIR');
    await user.click(within(table).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(receivedBody).toEqual({ condition: 'FAIR' }));
  });

  it('returning without choosing a condition sends an empty body', async () => {
    let receivedBody;
    server.use(
      http.post('*/api/requests/:id/return', async ({ request, params }) => {
        receivedBody = await request.json();
        const found = checkoutRequests.find((r) => r.id === params.id);
        return HttpResponse.json({ ...(found ?? {}), id: params.id, state: 'RETURNED' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'CHECKED_OUT');
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.click(within(table).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(receivedBody).toEqual({}));
  });

  it('shows an error and lets a failed return be retried with the same chosen condition', async () => {
    let returnCalls = 0;
    let receivedBody;
    server.use(
      http.post('*/api/requests/:id/return', async ({ request }) => {
        returnCalls += 1;
        receivedBody = await request.json();
        return returnCalls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json({ ...checkoutRequests[2], state: 'RETURNED' });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<ApprovalQueuePage />, { user: approverUser });
    await user.selectOptions(screen.getByLabelText('State'), 'CHECKED_OUT');
    const table = await screen.findByRole('table', { name: 'Requests' });
    await user.selectOptions(within(table).getByLabelText('Returned condition'), 'POOR');
    await user.click(within(table).getByRole('button', { name: 'Return' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not complete that action');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(returnCalls).toBe(2);
    // The retry replays the same payload the first attempt failed with, not an empty one.
    expect(receivedBody).toEqual({ condition: 'POOR' });
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
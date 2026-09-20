// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: tests for the request detail screen: rendering, role- and state-driven actions, the 404 path, and a 409 surfaced readably
// Human Contributions: pending team review
// Notes: Written for SCRUM-123. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the request detail screen (SCRUM-123).
 *
 * Three things matter here, and they are the three the ticket asks for:
 *
 *  - **The actions match the state machine and the viewer.** A member sees cancel on their own
 *    pending request and nothing that belongs to an approver; an approver sees approve and deny on
 *    the same request. A terminal state offers nothing at all.
 *  - **A request the viewer may not see renders the not-found panel**, not an error dump — the API
 *    answers 404 for another member's request and for another organisation's alike (SR-2), and the
 *    screen must not turn that into "something went wrong".
 *  - **An illegal transition is readable.** The API's 409 says what went wrong; the page shows it
 *    rather than swallowing it.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  approverUser,
  checkoutRequests,
  errorResponse,
  meHandler,
  memberUser,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { authenticatedState, renderApp } from '../../utils/render';

const pending = checkoutRequests.find((r) => r.state === 'PENDING');
const approved = checkoutRequests.find((r) => r.state === 'APPROVED');
const denied = checkoutRequests.find((r) => r.state === 'DENIED');

/** Open one request as `user`, waiting for the detail screen to settle. */
async function openRequest(request, user) {
  server.use(meHandler(user));
  const utils = renderApp(`/requests/${request.id}`, authenticatedState(user));
  await screen.findByRole('heading', { level: 2, name: 'Actions' });
  return utils;
}

describe('RequestDetailPage', () => {
  it('shows the request, its asset and unit, the requester and the history', async () => {
    await openRequest(approved, memberUser);

    expect(screen.getByRole('heading', { level: 1, name: 'Dell XPS 15' })).toBeVisible();
    // Scoped to the details list: "Approved" is also a history entry, which is as it should be.
    const details = screen.getByLabelText('Request details');
    expect(details).toHaveTextContent('State');
    expect(details).toHaveTextContent('Approved');
    expect(details).toHaveTextContent(memberUser.email);
    expect(details).toHaveTextContent('xps-002');
    // The history is the API's, oldest first.
    const history = screen.getByRole('list', { name: 'Request history' });
    expect(history).toHaveTextContent('Submitted');
    expect(history).toHaveTextContent('Approved');
  });

  it('offers the requester cancel, and none of the approver’s actions', async () => {
    await openRequest(pending, memberUser);

    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('offers an approver approve and deny on the same request (the wrong-role case)', async () => {
    await openRequest(pending, approverUser);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeVisible();
    // Not the requester, so cancelling is not theirs to do.
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
  });

  it('offers the handoff on an approved request, and a return needs a condition', async () => {
    await openRequest(approved, approverUser);

    expect(screen.getByRole('button', { name: 'Record handoff' })).toBeVisible();
    // Not yet checked out, so there is nothing to return and no condition to pick.
    expect(screen.queryByRole('button', { name: 'Record return' })).toBeNull();
    expect(screen.queryByLabelText(/returned condition/i)).toBeNull();
  });

  it('offers nothing on a request in a terminal state', async () => {
    await openRequest(denied, approverUser);

    expect(screen.getByText(/nothing to do on this request/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('renders the not-found panel for a request the caller may not see (SR-2)', async () => {
    server.use(meHandler(memberUser));
    renderApp('/requests/6aab2a45c6e457e01ac09999', authenticatedState(memberUser));

    expect(
      await screen.findByRole('heading', { level: 1, name: /request not found/i }),
    ).toBeVisible();
    // Not the generic failure panel.
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
    expect(screen.getByRole('link', { name: /back to my requests/i })).toBeVisible();
  });

  it('shows the API’s 409 when a transition is no longer legal', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/requests/:id/approve', () =>
        errorResponse(
          409,
          'INVALID_STATE_TRANSITION',
          'Cannot transition from APPROVED to APPROVED',
        ),
      ),
    );
    await openRequest(pending, approverUser);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot transition/i);
  });

  it('reloads after a successful action', async () => {
    const user = userEvent.setup();
    let reads = 0;
    server.use(
      meHandler(approverUser),
      http.get('*/api/requests/:id', () => {
        reads += 1;
        return HttpResponse.json({
          request: pending,
          asset: null,
          unit: null,
          requester: null,
          decidedBy: null,
          timeline: [{ at: '2026-09-18T00:00:00.000Z', event: 'SUBMITTED' }],
        });
      }),
      http.post('*/api/requests/:id/approve', () => HttpResponse.json({ request: pending })),
    );
    renderApp(`/requests/${pending.id}`, authenticatedState(approverUser));
    await screen.findByRole('heading', { level: 2, name: 'Actions' });
    const before = reads;

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });

  it('is reachable from the requests list', async () => {
    const user = userEvent.setup();
    server.use(meHandler(memberUser));
    const { router } = renderApp('/requests', authenticatedState(memberUser));
    const link = await screen.findByRole('link', { name: 'Pending' });

    await user.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/requests/${pending.id}`));
  });
});

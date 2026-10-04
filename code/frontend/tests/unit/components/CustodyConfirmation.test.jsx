// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-205 story)
// AI-Assisted Areas: UI tests for custody confirmation: borrower pickup and return on the detail page, confirm/reject, the pickup-window setting, and the self-recorded history note
// Human Contributions: story and acceptance criteria by Orelmis Toribio; pending team review
// Notes: Backend rules (403s, the sole-confirmer count, audit entries) are covered by backend custodyConfirmation.test.js.

/**
 * UI tests for custody confirmation (SCRUM-205).
 *
 * What the screens must get right: each side sees the button for its own half of a handoff and no
 * other; what is typed travels to the API; and the API's answers (a 409 for a pickup already
 * recorded, `canConfirmReturn` for who may confirm) are shown rather than second-guessed.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AssetHistory } from '../../../src/components/AssetHistory';
import { OrgSettingsPage } from '../../../src/pages/OrgSettingsPage';
import {
  adminUser,
  approverUser,
  checkoutRequests,
  errorResponse,
  meHandler,
  memberUser,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { authenticatedState, renderApp, renderWithAuth } from '../../utils/render';

const approved = checkoutRequests.find((r) => r.state === 'APPROVED');
const checkedOut = checkoutRequests.find((r) => r.state === 'CHECKED_OUT');
const pendingReturn = {
  ...checkedOut,
  state: 'RETURN_PENDING',
  reportedCondition: 'FAIR',
  reportedNote: 'left at the front desk',
  returnInitiatedAt: '2026-10-02T09:00:00.000Z',
};

/**
 * Serve one request's detail payload.
 * @param {object} request
 * @param {object} [overrides] merged over a minimal valid response, e.g. `{ canConfirmReturn: true }`
 */
const serveDetail = (request, overrides = {}) =>
  server.use(
    http.get(`*/api/requests/${request.id}`, () =>
      HttpResponse.json({
        request,
        asset: null,
        unit: null,
        requester: { id: memberUser.id, name: memberUser.name, email: memberUser.email },
        decidedBy: null,
        timeline: [{ at: '2026-09-18T00:00:00.000Z', event: 'SUBMITTED' }],
        ...overrides,
      }),
    ),
  );

/**
 * Record each call to one action endpoint with its body.
 * @param {string} action the path segment after the request id
 * @returns {{ calls: Array<{ id: string, body: unknown }> }}
 */
const captureAction = (action) => {
  const record = { calls: [] };
  server.use(
    http.post(`*/api/requests/:id/${action}`, async ({ params, request }) => {
      record.calls.push({ id: params.id, body: await request.json().catch(() => null) });
      return HttpResponse.json({ id: params.id });
    }),
  );
  return record;
};

/** Open one request as `user` and wait for the detail screen to settle. */
async function openRequest(request, user) {
  server.use(meHandler(user));
  renderApp(`/requests/${request.id}`, authenticatedState(user));
  await screen.findByRole('heading', { level: 2, name: 'Actions' });
}

describe('RequestDetailPage: pickup (AT-1, AT-2)', () => {
  it('the borrower records their own pickup with "I’ve picked it up"', async () => {
    const user = userEvent.setup();
    const checkout = captureAction('checkout');
    serveDetail(approved);
    await openRequest(approved, memberUser);

    expect(screen.queryByRole('button', { name: 'Record handoff' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'I’ve picked it up' }));

    await waitFor(() => expect(checkout.calls).toHaveLength(1));
    expect(checkout.calls[0].id).toBe(approved.id);
  });

  it('says the item is already checked out when the other side recorded it first', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/requests/:id/checkout', () =>
        errorResponse(409, 'CONFLICT', 'This item is already checked out'),
      ),
    );
    serveDetail(approved);
    await openRequest(approved, memberUser);

    await user.click(screen.getByRole('button', { name: 'I’ve picked it up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This item is already checked out');
  });
});

describe('RequestDetailPage: starting a return (AT-4)', () => {
  it('sends the condition and note the borrower reports', async () => {
    const user = userEvent.setup();
    const initiate = captureAction('initiate-return');
    serveDetail(checkedOut);
    await openRequest(checkedOut, memberUser);

    await user.selectOptions(screen.getByLabelText(/condition you are returning it in/i), 'POOR');
    await user.type(screen.getByLabelText(/note/i), 'screen cracked');
    await user.click(screen.getByRole('button', { name: 'Return this item' }));

    await waitFor(() => expect(initiate.calls).toHaveLength(1));
    expect(initiate.calls[0].body).toEqual({ condition: 'POOR', note: 'screen cracked' });
  });

  it('tells the borrower they are still responsible while the return waits', async () => {
    serveDetail(pendingReturn, { canConfirmReturn: false });
    await openRequest(pendingReturn, memberUser);

    expect(screen.getByRole('status')).toHaveTextContent(/responsible for the item/i);
    expect(screen.queryByRole('button', { name: 'Confirm return' })).toBeNull();
    expect(screen.getByLabelText('Request details')).toHaveTextContent('Fair');
    expect(screen.getByLabelText('Request details')).toHaveTextContent('left at the front desk');
  });
});

describe('RequestDetailPage: confirming and rejecting (AT-5..AT-8)', () => {
  it('a different confirmer confirms with the received condition, starting from the reported one', async () => {
    const user = userEvent.setup();
    const ret = captureAction('return');
    serveDetail(pendingReturn, { canConfirmReturn: true });
    await openRequest(pendingReturn, adminUser);

    const select = screen.getByLabelText(/condition received/i);
    expect(select).toHaveValue('FAIR');
    await user.selectOptions(select, 'POOR');
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    await waitFor(() => expect(ret.calls).toHaveLength(1));
    expect(ret.calls[0].body).toEqual({ condition: 'POOR' });
  });

  it('rejecting needs a reason, and sends it', async () => {
    const user = userEvent.setup();
    const reject = captureAction('reject-return');
    serveDetail(pendingReturn, { canConfirmReturn: true });
    await openRequest(pendingReturn, adminUser);

    const button = screen.getByRole('button', { name: 'Reject return' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/reason for rejecting/i), 'Nothing at the desk');
    await user.click(button);

    await waitFor(() => expect(reject.calls).toHaveLength(1));
    expect(reject.calls[0].body).toEqual({ reason: 'Nothing at the desk' });
  });

  it('hides Confirm and Reject when the API says this viewer may not confirm (AT-7)', async () => {
    const own = { ...pendingReturn, requesterId: approverUser.id };
    serveDetail(own, { canConfirmReturn: false });
    await openRequest(own, approverUser);

    expect(screen.queryByRole('button', { name: 'Confirm return' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject return' })).toBeNull();
  });

  it('shows them to the sole admin on their own return when the API allows it (AT-8)', async () => {
    const own = { ...pendingReturn, requesterId: adminUser.id };
    serveDetail(own, { canConfirmReturn: true });
    await openRequest(own, adminUser);

    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reject return' })).toBeVisible();
  });
});

describe('OrgSettingsPage: pickup window (AT-3)', () => {
  it('shows the current window and saves a new one', async () => {
    const user = userEvent.setup();
    const sent = [];
    server.use(
      http.patch('*/api/organizations/me/pickup-settings', async ({ request }) => {
        const body = await request.json();
        sent.push(body);
        return HttpResponse.json(body);
      }),
    );
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    const input = await screen.findByLabelText(/hours to collect/i);
    expect(input).toHaveValue(48);
    const save = screen.getByRole('button', { name: 'Save pickup window' });
    expect(save).toBeDisabled();
    await user.clear(input);
    await user.type(input, '24');
    await user.click(save);

    await waitFor(() => expect(sent).toEqual([{ graceHours: 24 }]));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });

  it('will not save a value outside whole hours 0 to 720', async () => {
    const user = userEvent.setup();
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    const input = await screen.findByLabelText(/hours to collect/i);
    await user.clear(input);
    await user.type(input, '1000');

    expect(screen.getByRole('button', { name: 'Save pickup window' })).toBeDisabled();
  });

  it('runs the expiry now and says how many approvals expired', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/requests/expire-approvals', () => HttpResponse.json({ expired: 2 })),
    );
    renderWithAuth(<OrgSettingsPage />, { user: adminUser });

    await user.click(
      await screen.findByRole('button', { name: 'Expire uncollected approvals now' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent('2 approvals expired');
  });
});

describe('AssetHistory: self-recorded custody changes (AT-1, AT-8)', () => {
  it('marks a self-confirmed return and a borrower-recorded pickup', async () => {
    server.use(
      http.get('*/api/assets/:id/history', () =>
        HttpResponse.json({
          asset: { id: 'a1', name: 'Laptop', category: 'laptop' },
          items: [
            {
              id: 'e2',
              action: 'ASSET_RETURNED',
              timestamp: '2026-10-02T00:00:00.000Z',
              unitTag: 'L-1',
              after: { status: 'AVAILABLE', selfConfirmed: true },
              actor: { id: adminUser.id, name: adminUser.name, role: 'ORG_ADMIN' },
            },
            {
              id: 'e1',
              action: 'ASSET_CHECKED_OUT',
              timestamp: '2026-10-01T00:00:00.000Z',
              unitTag: 'L-1',
              after: { status: 'OUT', selfReported: true },
              actor: { id: memberUser.id, name: memberUser.name, role: 'MEMBER' },
            },
          ],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
    );
    renderWithAuth(<AssetHistory assetId="a1" />, { user: adminUser });

    const history = await screen.findByRole('list', { name: 'Asset history' });
    expect(history).toHaveTextContent('(self-confirmed)');
    expect(history).toHaveTextContent('(recorded by the borrower)');
  });
});

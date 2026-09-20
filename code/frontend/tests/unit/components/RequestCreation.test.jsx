// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-124 ticket)
// AI-Assisted Areas: request creation flow tests — affordance gating, client-side window validation, happy path, the unavailable-unit race, and the request appearing on MyRequestsPage
// Human Contributions: pending team review
// Notes: The real tests for SCRUM-124; replaces the staged describe.skip block that was in
// pendingScreens.test.jsx (see code/docs/staged-acceptance-tests.md). Must be reviewed by the
// owning team member before merge.

/**
 * The request creation flow, from the asset detail page (SCRUM-124).
 *
 * The flow spans two screens — pick a unit and submit on the asset page, then see the request — so
 * these live in one feature file rather than being split across AssetDetailPage's and
 * MyRequestsPage's own files. Each test below restates one of the ticket's acceptance criteria.
 *
 * The case worth the most attention is the race: the units table is rendered from a response that is
 * already seconds old, so between load and submit somebody else can take the unit. The server
 * refuses, and the page has to both say so in words a member can act on and stop claiming the unit
 * is available.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AssetDetailPage } from '../../../src/pages/AssetDetailPage';
import { MyRequestsPage } from '../../../src/pages/MyRequestsPage';
import {
  assets,
  assetUnits,
  checkoutRequests,
  errorResponse,
  memberUser,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** The first fixture asset has one AVAILABLE unit (xps-001) and one OUT unit (xps-002). */
const asset = assets[0];
const availableUnit = assetUnits[asset.id].find((u) => u.status === 'AVAILABLE');
const unavailableUnit = assetUnits[asset.id].find((u) => u.status !== 'AVAILABLE');

/**
 * Mount the asset detail page as a member, with somewhere for a successful request to navigate to.
 * @param {object} [options] passed through to `renderWithAuth`
 */
function renderDetail(options) {
  return renderWithAuth(<AssetDetailPage />, {
    user: memberUser,
    route: `/assets/${asset.id}`,
    extraRoutes: [
      { path: '/assets/:id', element: <AssetDetailPage /> },
      { path: '/requests/:id', element: <h1>Request detail</h1> },
      { path: '/requests', element: <MyRequestsPage /> },
    ],
    ...options,
  });
}

/** Open the request form for the asset's available unit. */
async function openRequestForm() {
  renderDetail();
  await screen.findByRole('heading', { level: 1, name: asset.name });
  await userEvent.click(screen.getByRole('button', { name: `Request unit ${availableUnit.tag}` }));
  return screen.findByRole('heading', { level: 2, name: `Request unit ${availableUnit.tag}` });
}

describe('SCRUM-124: request creation flow from asset detail', () => {
  it('shows a "Request this" affordance only on units whose status is AVAILABLE', async () => {
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: asset.name });

    const table = screen.getByRole('table', { name: 'Units' });
    expect(
      within(table).getByRole('button', { name: `Request unit ${availableUnit.tag}` }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole('button', { name: `Request unit ${unavailableUnit.tag}` }),
    ).not.toBeInTheDocument();
  });

  it('offers no affordance at all on a retired asset, whatever its units say', async () => {
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...asset,
          retiredAt: '2026-09-01T00:00:00.000Z',
          units: assetUnits[asset.id],
        }),
      ),
    );
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: asset.name });
    expect(
      screen.queryByRole('button', { name: `Request unit ${availableUnit.tag}` }),
    ).not.toBeInTheDocument();
  });

  it('rejects neededTo <= neededFrom client-side, to match the createRequestBody schema', async () => {
    let posted = false;
    server.use(
      http.post('*/api/requests', () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    await openRequestForm();

    // Equal dates, which the schema's `neededTo > neededFrom` refine also rejects.
    await userEvent.type(screen.getByLabelText('Needed from'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Needed until'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    const error = await screen.findByText('The end date must be after the start date.');
    // Reported against neededTo, the same field the schema's refine names.
    const to = screen.getByLabelText('Needed until');
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(to.getAttribute('aria-describedby')).toContain(error.id);
    // Caught in the browser, so no round trip was spent on it.
    expect(posted).toBe(false);
  });

  it('requires both dates before it will submit', async () => {
    await openRequestForm();
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Choose the date you need it from.')).toBeInTheDocument();
    expect(screen.getByText('Choose the date you need it until.')).toBeInTheDocument();
  });

  it("on success, navigates to the new request's detail page", async () => {
    let sent;
    server.use(
      http.post('*/api/requests', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          { ...sent, id: checkoutRequests[0].id, state: 'PENDING' },
          { status: 201 },
        );
      }),
    );
    const { router } = renderDetail();
    await screen.findByRole('heading', { level: 1, name: asset.name });
    await userEvent.click(
      screen.getByRole('button', { name: `Request unit ${availableUnit.tag}` }),
    );

    await userEvent.type(screen.getByLabelText('Needed from'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Needed until'), '2026-10-15');
    await userEvent.type(screen.getByLabelText('Note'), '  For the field trip  ');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent.unitId).toBe(availableUnit.id);
    expect(sent.neededFrom).toBe('2026-10-01');
    expect(sent.neededTo).toBe('2026-10-15');
    expect(sent.note).toBe('For the field trip');
    // No requesterId: who is asking comes from the session, server-side.
    expect(sent).not.toHaveProperty('requesterId');

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/requests/${checkoutRequests[0].id}`),
    );
  });

  it('surfaces a unit that became unavailable as a readable message and refreshes the unit state', async () => {
    let assetReads = 0;
    server.use(
      // Available on the first read, taken by the time the page refetches.
      http.get('*/api/assets/:id', () => {
        assetReads += 1;
        const units =
          assetReads === 1
            ? assetUnits[asset.id]
            : assetUnits[asset.id].map((u) =>
                u.id === availableUnit.id ? { ...u, status: 'OUT' } : u,
              );
        return HttpResponse.json({ ...asset, units });
      }),
      http.post('*/api/requests', () =>
        errorResponse(409, 'CONFLICT', 'That unit is no longer available'),
      ),
    );
    await openRequestForm();

    await userEvent.type(screen.getByLabelText('Needed from'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Needed until'), '2026-10-15');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    // The reason, in words, rather than a bare status code.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That unit is no longer available');
    expect(alert.textContent).not.toMatch(/409/);

    // And the page stops claiming the unit is available.
    await waitFor(() => expect(assetReads).toBeGreaterThan(1));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: `Request unit ${availableUnit.tag}` }),
      ).not.toBeInTheDocument(),
    );
  });

  it('the newly created request appears on MyRequestsPage', async () => {
    const created = {
      ...checkoutRequests[0],
      id: '6aab2a45c6e457e01ac0973f',
      neededFrom: '2026-11-01T00:00:00.000Z',
      neededTo: '2026-11-08T00:00:00.000Z',
      state: 'PENDING',
    };
    let submitted = false;
    server.use(
      http.post('*/api/requests', () => {
        submitted = true;
        return HttpResponse.json(created, { status: 201 });
      }),
      // The list reflects the new request only once it has been made, so a pass cannot come from a
      // fixture that always contained it.
      http.get('*/api/requests', () => {
        const items = submitted ? [created, ...checkoutRequests] : checkoutRequests;
        return HttpResponse.json({ items, total: items.length, page: 1, limit: 25 });
      }),
    );

    const { router } = renderDetail();
    await screen.findByRole('heading', { level: 1, name: asset.name });
    await userEvent.click(
      screen.getByRole('button', { name: `Request unit ${availableUnit.tag}` }),
    );
    await userEvent.type(screen.getByLabelText('Needed from'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('Needed until'), '2026-11-08');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(submitted).toBe(true));

    router.navigate('/requests');
    await screen.findByRole('heading', { level: 1, name: 'My requests' });
    const table = await screen.findByRole('table', { name: 'Requests' });
    const firstRow = within(table).getAllByRole('row')[1];
    expect(within(firstRow).getByRole('link', { name: 'Pending' })).toHaveAttribute(
      'href',
      `/requests/${created.id}`,
    );
  });

  it('cancelling closes the form without submitting anything', async () => {
    let posted = false;
    server.use(
      http.post('*/api/requests', () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    await openRequestForm();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('heading', { level: 2, name: `Request unit ${availableUnit.tag}` }),
    ).not.toBeInTheDocument();
    expect(posted).toBe(false);
    // The affordance comes back, so the member can start again.
    expect(
      screen.getByRole('button', { name: `Request unit ${availableUnit.tag}` }),
    ).toBeInTheDocument();
  });

  it('renders a field-level validation error from the API beside its field', async () => {
    server.use(
      http.post('*/api/requests', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'neededTo', message: 'neededTo must be after neededFrom' },
        ]),
      ),
    );
    await openRequestForm();

    await userEvent.type(screen.getByLabelText('Needed from'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('Needed until'), '2026-10-15');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    const error = await screen.findByText('neededTo must be after neededFrom');
    expect(screen.getByLabelText('Needed until').getAttribute('aria-describedby')).toContain(
      error.id,
    );
  });
});

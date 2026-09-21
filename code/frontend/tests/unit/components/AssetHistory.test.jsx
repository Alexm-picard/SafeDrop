/**
 * Tests for the asset chain-of-custody timeline (SCRUM-43, covering SCRUM-40 and SCRUM-41).
 *
 * The ordering test is the one to keep if any are ever trimmed. The component renders whatever order
 * the API sends, so a mistake here — a stray `.reverse()`, a sort on the wrong key — would put the
 * oldest event at the top of a screen captioned "newest first", and every reader would draw the wrong
 * conclusion from a record that is itself correct. Nothing else on the page would look wrong.
 *
 * The three state tests (empty, error, 403) exist because SCRUM-41 asks for them explicitly: an admin
 * looking at an asset nothing has happened to should see a sentence saying so, not an empty list that
 * reads like a failure to load.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetHistory } from '../../../src/components/AssetHistory';
import {
  adminUser,
  assetHistoryEvents,
  assetHistoryPage,
  assets,
  errorResponse,
  memberUser,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** Query strings the component has sent, oldest first. */
let requests = [];
beforeEach(() => {
  requests = [];
  server.use(
    http.get('*/api/assets/:id/history', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.searchParams);
      return HttpResponse.json(assetHistoryPage(url.searchParams));
    }),
  );
});
/** The parameters of the most recent history request. */
const lastRequest = () => requests[requests.length - 1];
/** Mount the component for the first fixture asset, as an admin unless told otherwise. */
const renderHistory = (user = adminUser) =>
  renderWithAuth(<AssetHistory assetId={assets[0].id} />, { user });
/** The timeline's entries, in render order. */
const entries = () =>
  within(screen.getByRole('list', { name: /asset history/i })).getAllByRole('listitem');

describe('AssetHistory (SCRUM-40)', () => {
  it('shows a loading state, then a page of events newest first', async () => {
    renderHistory();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    expect(await screen.findByRole('list', { name: /asset history/i })).toBeInTheDocument();
    expect(entries()).toHaveLength(25);
    // The fixture walks backwards one day per event, so the API's first item is the most recent.
    // Reading the rendered order back against the fixture order is what catches a stray reverse.
    const renderedTimes = entries().map((li) => li.textContent);
    expect(renderedTimes[0]).toContain(assetHistoryEvents[0].actor.name);
    expect(renderedTimes[1]).toContain(assetHistoryEvents[1].actor.name);
  });

  it('shows each event’s action, actor name and role, humanised', async () => {
    renderHistory();
    await screen.findByRole('list', { name: /asset history/i });

    const first = within(entries()[0]);
    expect(first.getByText(assetHistoryEvents[0].actor.name)).toBeInTheDocument();
    // Humanised, not the raw enum — the same treatment the audit log gives it.
    expect(first.getByText('Asset checked out')).toBeInTheDocument();
    expect(screen.queryByText('ASSET_CHECKED_OUT')).not.toBeInTheDocument();
  });

  it('names the unit for a unit-level event and omits it for an asset-level one', async () => {
    renderHistory();
    await screen.findByRole('list', { name: /asset history/i });

    expect(within(entries()[0]).getByText(/unit .+/)).toBeInTheDocument();
    // The asset-level event (ASSET_CREATED) is last in the fixture, so it lands on page 2.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /next/i }));
    const assetLevel = entries().at(-1);
    expect(within(assetLevel).getByText('Asset created')).toBeInTheDocument();
    expect(within(assetLevel).queryByText(/^unit /)).not.toBeInTheDocument();
  });

  it('states that the record cannot be edited, and offers no way to change it', async () => {
    renderHistory();
    await screen.findByRole('list', { name: /asset history/i });

    expect(screen.getByRole('status')).toHaveTextContent(/cannot be edited/i);
    // SR-8: the API exposes no mutation, so neither may this screen.
    for (const label of [/edit/i, /delete/i, /remove/i, /save/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('reports the total and pages through it server-side', async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole('list', { name: /asset history/i });
    expect(screen.getByRole('status')).toHaveTextContent('30 events');

    await user.click(screen.getByRole('button', { name: /next/i }));
    // Asserting on the *request* rather than only on what renders: paging that never reaches the
    // query string would still look plausible on screen while showing page 1 again.
    expect(lastRequest().get('page')).toBe('2');
    expect(await screen.findByText(/page 2 of 2/i)).toBeInTheDocument();
    expect(entries()).toHaveLength(5);
  });

  it('disables Previous on the first page and Next on the last', async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole('list', { name: /asset history/i });

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/page 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

describe('AssetHistory states (SCRUM-41)', () => {
  it('says so plainly when nothing has been recorded yet', async () => {
    server.use(
      http.get('*/api/assets/:id/history', ({ request }) =>
        HttpResponse.json(assetHistoryPage(new URL(request.url).searchParams, [])),
      ),
    );
    renderHistory();

    expect(await screen.findByText(/nothing has been recorded/i)).toBeInTheDocument();
    // An empty history is not a failure, so it must not be announced as one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /asset history/i })).not.toBeInTheDocument();
  });

  it('offers a retry when the load fails', async () => {
    server.use(
      http.get('*/api/assets/:id/history', () =>
        errorResponse(500, 'INTERNAL', 'Something went wrong'),
      ),
    );
    renderHistory();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('explains a 403 instead of reporting it as a fault', async () => {
    // The page renders this for admins only, but that is usability rather than security — the API
    // decides (SR-1). Reached another way, the answer should read as a rule, not as a breakage.
    server.use(
      http.get('*/api/assets/:id/history', () =>
        errorResponse(403, 'FORBIDDEN', 'You do not have permission'),
      ),
    );
    renderHistory(memberUser);

    expect(
      await screen.findByText(/only an organization administrator can view/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

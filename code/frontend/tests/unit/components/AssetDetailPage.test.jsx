// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: AssetDetailPage tests — units and their statuses, not-found and error states
// Human Contributions: reviewed by Orelmis Toribio (PR #14, 2026-09-19)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the asset detail page (SCRUM-115).
 *
 * The route is exercised through `renderWithAuth`'s `extraRoutes`, with `:id` in the URL, so
 * `useParams()` resolves the same way it does in the real app rather than being stubbed out.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AssetDetailPage } from '../../../src/pages/AssetDetailPage';
import { adminUser, assets, assetUnits, errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';
const renderDetail = (id, options) =>
  renderWithAuth(<AssetDetailPage />, {
    user: adminUser,
    route: `/assets/${id}`,
    extraRoutes: [{ path: '/assets/:id', element: <AssetDetailPage /> }],
    ...options,
  });
describe('AssetDetailPage', () => {
  it('shows a loading state, then the asset with its units and their statuses', async () => {
    renderDetail(assets[0].id);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(
      await screen.findByRole('heading', { level: 1, name: assets[0].name }),
    ).toBeInTheDocument();
    expect(screen.getByText(assets[0].category)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Units' });
    const units = assetUnits[assets[0].id];
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(units.length);
    expect(within(table).getByText(units[0].tag)).toBeInTheDocument();
    expect(within(table).getByText('Available')).toBeInTheDocument();
    expect(within(table).getByText('Out')).toBeInTheDocument();
    expect(within(table).queryByText('AVAILABLE')).not.toBeInTheDocument();
  });
  it('shows an explicit empty state when the asset has no units', async () => {
    server.use(http.get('*/api/assets/:id', () => HttpResponse.json({ ...assets[0], units: [] })));
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.getByText('This asset has no units yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('renders ErrorState for an id that does not exist (404) and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/assets/:id', () => {
        calls += 1;
        return calls === 1
          ? errorResponse(404, 'NOT_FOUND', 'Asset not found')
          : HttpResponse.json({ ...assets[0], units: assetUnits[assets[0].id] });
      }),
    );
    const user = userEvent.setup();
    renderDetail(assets[0].id);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this asset');
    expect(alert).toHaveTextContent('NOT_FOUND');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: assets[0].name }),
    ).toBeInTheDocument();
    expect(calls).toBe(2);
  });
  it('renders ErrorState for another org’s asset id, the same as a missing one (SR-2)', async () => {
    server.use(
      http.get('*/api/assets/:id', () => errorResponse(404, 'NOT_FOUND', 'Asset not found')),
    );
    renderDetail('0'.repeat(24));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this asset');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

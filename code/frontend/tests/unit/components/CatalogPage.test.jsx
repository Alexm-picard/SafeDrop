// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: CatalogPage tests — loading, populated, empty and error states
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the catalogue page (SCRUM-115).
 *
 * Walks the states every list screen has: loading, the assets from the API rendered as links to
 * their detail page, an explicit empty state (not just an absent table), and ErrorState with a
 * working retry.
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CatalogPage } from '../../../src/pages/CatalogPage';
import { adminUser, assets, errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';
describe('CatalogPage', () => {
  it('shows a loading state, then the assets from the API as links to their detail page', async () => {
    renderWithAuth(<CatalogPage />, { user: adminUser });
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    const table = await screen.findByRole('table', { name: 'Assets' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(assets.length);
    const link = within(table).getByRole('link', { name: assets[0].name });
    expect(link).toHaveAttribute('href', `/assets/${assets[0].id}`);
    expect(within(table).getByText(assets[0].category)).toBeInTheDocument();
  });
  it('shows an explicit empty state rather than an empty table', async () => {
    server.use(
      http.get('*/api/assets', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderWithAuth(<CatalogPage />, { user: adminUser });
    expect(await screen.findByText('No assets yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('renders ErrorState when the API fails and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/assets', () => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json({ items: assets, total: assets.length, page: 1, limit: 25 });
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<CatalogPage />, { user: adminUser });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the catalog');
    expect(alert).toHaveTextContent('INTERNAL_ERROR');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Assets' })).toBeInTheDocument();
    expect(calls).toBe(2);
  });
  it('shows the RequireRole denial notice when redirected here with state.denied', async () => {
    renderWithAuth(<CatalogPage />, {
      user: adminUser,
      route: { pathname: '/', state: { denied: true } },
    });
    expect(screen.getByText('You do not have access to that page.')).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Assets' });
  });
});

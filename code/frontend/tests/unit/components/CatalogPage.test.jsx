/**
 * Tests for the catalogue page (SCRUM-115) and its search bar (SCRUM-201).
 *
 * Walks the states every list screen has: loading, the assets from the API rendered as links to
 * their detail page, an explicit empty state (not just an absent table), and ErrorState with a
 * working retry.
 *
 * The search tests run on real timers: the debounce is a few hundred milliseconds, well inside
 * Testing Library's default wait, and real timers keep MSW and user-event behaving as they do in a
 * browser.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CatalogPage } from '../../../src/pages/CatalogPage';
import {
  adminUser,
  assets,
  errorResponse,
  groups,
  memberUser,
  plainSearch,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';
describe('CatalogPage', () => {
  it('shows a loading state, then the assets from the API as links to their detail page', async () => {
    renderWithAuth(<CatalogPage />, { user: adminUser });
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    const table = await screen.findByRole('list', { name: 'Assets' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const rows = within(table).getAllByRole('listitem');
    expect(rows).toHaveLength(assets.length);
    const link = within(table).getByRole('link', { name: assets[0].name });
    expect(link).toHaveAttribute('href', `/assets/${assets[0].id}`);
    expect(within(table).getByText(assets[0].category)).toBeInTheDocument();
  });
  it('shows an explicit empty state rather than an empty gallery', async () => {
    server.use(
      http.get('*/api/assets', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderWithAuth(<CatalogPage />, { user: adminUser });
    expect(await screen.findByText('No assets yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Assets' })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('list', { name: 'Assets' })).toBeInTheDocument();
    expect(calls).toBe(2);
  });
  it('shows the RequireRole denial notice when redirected here with state.denied', async () => {
    renderWithAuth(<CatalogPage />, {
      user: adminUser,
      route: { pathname: '/', state: { denied: true } },
    });
    expect(screen.getByText('You do not have access to that page.')).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Assets' });
  });
});

describe('CatalogPage search (SCRUM-201)', () => {
  /**
   * Replace the search handler with one that records each request's `q` and answers with `respond`
   * (by default, the API's plain search over the fixture assets).
   */
  function recordSearches(
    respond = ({ request }) => HttpResponse.json(plainSearch(new URL(request.url).searchParams)),
  ) {
    const queries = [];
    server.use(
      http.get('*/api/assets/search', (info) => {
        queries.push(new URL(info.request.url).searchParams.get('q'));
        return respond(info);
      }),
    );
    return queries;
  }

  /** Render the page as a member and wait for the catalogue, so its loading state is out of the way. */
  async function renderCatalog() {
    const user = userEvent.setup();
    renderWithAuth(<CatalogPage />, { user: memberUser });
    await screen.findByRole('list', { name: 'Assets' });
    return { user, box: screen.getByRole('searchbox', { name: 'Search the catalog' }) };
  }

  it('sends one request for a burst of typing, and shows the matches in place of the catalogue', async () => {
    const queries = recordSearches();
    const { user, box } = await renderCatalog();

    await user.type(box, 'canon');

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link', { name: 'Canon EOS R6' })).toHaveAttribute(
      'href',
      `/assets/${assets[1].id}`,
    );
    expect(within(results).queryByText('Dell XPS 15')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Assets' })).not.toBeInTheDocument();
    // Debounced: five keystrokes, one request, carrying the whole word.
    expect(queries).toEqual(['canon']);
  });

  it('badges a restricted match in the search results, as on the list (SCRUM-202)', async () => {
    recordSearches(() =>
      HttpResponse.json({
        q: 'canon',
        matches: [
          {
            assetId: assets[1].id,
            name: assets[1].name,
            category: assets[1].category,
            description: '',
            allowedGroups: [{ id: groups[0].id, name: groups[0].name }],
            restricted: true,
          },
        ],
        clarification: null,
        aiAssisted: false,
      }),
    );
    const { user, box } = await renderCatalog();

    await user.type(box, 'canon');

    const results = await screen.findByRole('list', { name: 'Search results' });
    const [row] = within(results).getAllByRole('listitem');
    expect(within(row).getByRole('link', { name: assets[1].name })).toBeInTheDocument();
    expect(within(row).getByText('Restricted')).toHaveAttribute(
      'title',
      `Only members of ${groups[0].name} can request this`,
    );
  });

  it('shows no badge on an unrestricted search match', async () => {
    recordSearches();
    const { user, box } = await renderCatalog();

    await user.type(box, 'canon');

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link', { name: 'Canon EOS R6' })).toBeInTheDocument();
    expect(within(results).queryByText('Restricted')).not.toBeInTheDocument();
  });

  it('shows a searching state while the request is in flight', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    recordSearches(async ({ request }) => {
      await gate;
      return HttpResponse.json(plainSearch(new URL(request.url).searchParams));
    });
    const { user, box } = await renderCatalog();

    await user.type(box, 'canon');

    expect(await screen.findByRole('status')).toHaveTextContent(/searching/i);
    release();
    await screen.findByRole('list', { name: 'Search results' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("shows the model's reason for each match, and its clarification, when AI-assisted", async () => {
    recordSearches(() =>
      HttpResponse.json({
        matches: [
          {
            assetId: assets[1].id,
            name: 'Canon EOS R6',
            category: 'camera',
            description: '',
            reason: 'Full-frame camera that records video.',
          },
        ],
        clarification: 'Do you need video, or stills only?',
        aiAssisted: true,
      }),
    );
    const { user, box } = await renderCatalog();

    await user.type(box, 'something to film a talk');

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByText('Full-frame camera that records video.')).toBeVisible();
    expect(screen.getByText('Do you need video, or stills only?')).toBeVisible();
  });

  it('shows plain-search results with no reason and no error (SCRUM-103 AT2)', async () => {
    recordSearches();
    const { user, box } = await renderCatalog();

    await user.type(box, 'camera');

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link', { name: 'Canon EOS R6' })).toBeVisible();
    // No reason line on a plain match: there is no model to give one.
    expect(results.querySelector('.asset-reason')).toBeNull();
    // A fallback is invisible to the member: same results list, no alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    recordSearches();
    const { user, box } = await renderCatalog();

    await user.type(box, 'tripod');

    expect(await screen.findByText('No assets match “tripod”.')).toBeVisible();
  });

  it('ignores a slow answer to an older query once a newer one has been sent', async () => {
    const queries = recordSearches(async ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('q') === 'dell') {
        await delay(600);
      }
      return HttpResponse.json(plainSearch(params));
    });
    const { user, box } = await renderCatalog();

    await user.type(box, 'dell');
    await waitFor(() => expect(queries).toEqual(['dell']));
    await user.clear(box);
    await user.type(box, 'canon');

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link', { name: 'Canon EOS R6' })).toBeVisible();
    // Give the slow "dell" answer time to land; it must not replace the newer results.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText('Dell XPS 15')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Canon EOS R6' })).toBeVisible();
  });

  it('returns to the catalogue when the search is cleared', async () => {
    recordSearches();
    const { user, box } = await renderCatalog();
    await user.type(box, 'canon');
    await screen.findByRole('list', { name: 'Search results' });

    await user.clear(box);

    expect(await screen.findByRole('list', { name: 'Assets' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('sends nothing for whitespace, which the API would refuse', async () => {
    const queries = recordSearches();
    const { user, box } = await renderCatalog();

    await user.type(box, '   ');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(queries).toEqual([]);
    expect(screen.getByRole('list', { name: 'Assets' })).toBeVisible();
  });

  it('caps input at the 200 characters the API accepts', async () => {
    await renderCatalog();
    expect(screen.getByRole('searchbox', { name: 'Search the catalog' })).toHaveAttribute(
      'maxlength',
      '200',
    );
  });

  it('renders ErrorState when the search fails and retries on demand', async () => {
    let calls = 0;
    recordSearches(({ request }) => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
        : HttpResponse.json(plainSearch(new URL(request.url).searchParams));
    });
    const { user, box } = await renderCatalog();

    await user.type(box, 'canon');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not search the catalog');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Search results' })).toBeVisible();
    expect(calls).toBe(2);
  });
});

describe('CatalogPage — restricted equipment (SCRUM-150)', () => {
  it('badges a restricted asset, naming its groups, and leaves its link name unchanged', async () => {
    server.use(
      http.get('*/api/assets', () =>
        HttpResponse.json({
          items: [
            {
              ...assets[0],
              allowedGroups: [{ id: groups[0].id, name: groups[0].name }],
              restricted: true,
            },
            assets[1],
          ],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
    );
    renderWithAuth(<CatalogPage />, { user: memberUser });

    const table = await screen.findByRole('list', { name: 'Assets' });
    const [restrictedRow, openRow] = within(table).getAllByRole('listitem');
    // Restricted assets stay visible (the ticket's design note), with the reason beside the name.
    expect(within(restrictedRow).getByRole('link', { name: assets[0].name })).toBeInTheDocument();
    expect(within(restrictedRow).getByText('Restricted')).toHaveAttribute(
      'title',
      `Only members of ${groups[0].name} can request this`,
    );
    expect(within(openRow).queryByText('Restricted')).not.toBeInTheDocument();
  });
});

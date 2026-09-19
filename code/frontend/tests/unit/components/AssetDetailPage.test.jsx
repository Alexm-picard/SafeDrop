// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: AssetDetailPage tests — units and their statuses, not-found and error states
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the asset detail page (SCRUM-115).
 *
 * The route is exercised through `renderWithAuth`'s `extraRoutes`, with `:id` in the URL, so
 * `useParams()` resolves the same way it does in the real app rather than being stubbed out.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AssetDetailPage } from '../../../src/pages/AssetDetailPage';
import { adminUser, assets, assetUnits, errorResponse, memberUser } from '../../mocks/handlers';
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

/**
 * The admin actions SCRUM-122 hangs off this page.
 *
 * Two acceptance criteria are named by the ticket and are the first two tests: the **retire
 * confirmation** (a destructive action must not fire on one click, and the backend's refusal when a
 * unit is OUT or HELD must read as a sentence rather than a raw 409), and the **duplicate tag 409**
 * arriving as a field-level error under the tag input.
 *
 * The role test is here rather than in the routing tests because hiding these controls from a
 * non-admin is presentation only — it is worth asserting that the page does it, while remembering
 * that the API is what actually refuses the write (SR-1).
 */
describe('AssetDetailPage — admin actions (SCRUM-122)', () => {
  it('retires only after a confirmation step', async () => {
    let retired = 0;
    server.use(
      http.post('*/api/assets/:id/retire', () => {
        retired += 1;
        return HttpResponse.json({ ...assets[0], retiredAt: '2026-09-19T12:00:00.000Z' });
      }),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });

    // Pressing Retire arms the action; it must not call the API yet.
    await userEvent.click(screen.getByRole('button', { name: 'Retire asset' }));
    expect(retired).toBe(0);
    expect(screen.getByRole('alert')).toHaveTextContent(`Retire ${assets[0].name}?`);

    await userEvent.click(screen.getByRole('button', { name: 'Yes, retire it' }));
    await waitFor(() => expect(retired).toBe(1));
    expect(await screen.findByText(/Asset retired/)).toBeInTheDocument();
  });

  it('cancels the confirmation without retiring', async () => {
    let retired = 0;
    server.use(
      http.post('*/api/assets/:id/retire', () => {
        retired += 1;
        return HttpResponse.json(assets[0]);
      }),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });

    await userEvent.click(screen.getByRole('button', { name: 'Retire asset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(retired).toBe(0);
    // Back to the single armed trigger, so the page is where it started.
    expect(screen.getByRole('button', { name: 'Retire asset' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, retire it' })).not.toBeInTheDocument();
  });

  it('surfaces the backend’s refusal when a unit is still out, as a readable message', async () => {
    server.use(
      http.post('*/api/assets/:id/retire', () =>
        errorResponse(
          409,
          'CONFLICT',
          'Cannot retire an asset while one of its units is checked out or held',
        ),
      ),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });

    await userEvent.click(screen.getByRole('button', { name: 'Retire asset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, retire it' }));

    const notice = await screen.findByText(/Cannot retire an asset while one of its units/);
    expect(notice).toBeInTheDocument();
    // The reason, not the status code.
    expect(notice.textContent).not.toMatch(/409/);
  });

  it('shows a duplicate unit tag as a field error on the tag input', async () => {
    server.use(
      http.post('*/api/assets/:id/units', () =>
        errorResponse(409, 'CONFLICT', 'A unit with this tag already exists', { field: 'tag' }),
      ),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });

    await userEvent.type(screen.getByLabelText('Tag'), 'xps-001');
    await userEvent.click(screen.getByRole('button', { name: 'Add unit' }));

    const tagError = await screen.findByText('A unit with this tag already exists');
    const tagInput = screen.getByLabelText('Tag');
    expect(tagInput).toHaveAttribute('aria-invalid', 'true');
    expect(tagInput.getAttribute('aria-describedby')).toContain(tagError.id);
  });

  it('adds a unit and reports it, then reloads the list', async () => {
    let sent;
    server.use(
      http.post('*/api/assets/:id/units', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...sent, id: 'new-unit', status: 'AVAILABLE' }, { status: 201 });
      }),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });

    await userEvent.type(screen.getByLabelText('Tag'), 'xps-003');
    await userEvent.selectOptions(screen.getByLabelText('Condition'), 'FAIR');
    await userEvent.click(screen.getByRole('button', { name: 'Add unit' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent.tag).toBe('xps-003');
    expect(sent.condition).toBe('FAIR');
    // A blank serial is null, not "", matching `unitBody`'s nullable default.
    expect(sent.serial).toBeNull();
    expect(await screen.findByText('Added unit xps-003.')).toBeInTheDocument();
    // The form resets so the next unit of a batch can be typed straight away.
    expect(screen.getByLabelText('Tag')).toHaveValue('');
  });

  it('offers no admin controls to a MEMBER', async () => {
    renderDetail(assets[0].id, { user: memberUser });
    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.queryByRole('button', { name: 'Retire asset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit asset' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tag')).not.toBeInTheDocument();
    // The units table is still theirs to read.
    expect(screen.getByRole('table', { name: 'Units' })).toBeInTheDocument();
  });

  it('says an already-retired asset is retired and offers no retire button', async () => {
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          retiredAt: '2026-09-01T00:00:00.000Z',
          units: assetUnits[assets[0].id],
        }),
      ),
    );
    renderDetail(assets[0].id);
    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.getByText(/was retired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire asset' })).not.toBeInTheDocument();
    // Adding units to a retired asset makes no sense either.
    expect(screen.queryByLabelText('Tag')).not.toBeInTheDocument();
    // Editing is still allowed: a retired asset's name or description may need correcting.
    expect(screen.getByRole('link', { name: 'Edit asset' })).toBeInTheDocument();
  });
});

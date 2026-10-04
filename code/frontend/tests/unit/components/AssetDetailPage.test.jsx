// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: AssetDetailPage tests — units and their statuses, not-found and error states; Restricted badge and disabled Request button (SCRUM-150 AT-4)
// Human Contributions: reviewed by Orelmis Toribio (PR #14, 2026-09-19)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

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
import {
  adminUser,
  assets,
  assetUnits,
  errorResponse,
  groups,
  memberUser,
  similarItems,
} from '../../mocks/handlers';
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

/**
 * AC7 (SCRUM-141): an admin sends one unit for repair from the row it is in, and brings it back.
 *
 * The action lives in the unit row for the same reason "Request this" does: the choice is about one
 * physical item, made while looking at the list of them.
 *
 * The status *label* is not tested as a separate criterion, because it needs no code —
 * `humanize('MAINTENANCE')` already renders "Maintenance". It is asserted inside the tests below as a
 * consequence of the action, which is the only place it is evidence of anything.
 */
describe('AssetDetailPage — unit maintenance (SCRUM-141)', () => {
  /** The first unit of the laptop, which the fixture leaves AVAILABLE. */
  const availableUnit = () => assetUnits[assets[0].id][0];
  /** The second, which is OUT — in someone's hands, so it cannot go for repair. */
  const outUnit = () => assetUnits[assets[0].id][1];

  it('offers Start maintenance on an AVAILABLE unit, and not on one that is OUT', async () => {
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });

    expect(
      within(table).getByRole('button', {
        name: `Start maintenance for unit ${availableUnit().tag}`,
      }),
    ).toBeInTheDocument();
    // The API would refuse with 409, so offering the button would be a lie — the same reasoning
    // that keeps "Request this" off a unit nobody can borrow.
    expect(
      within(table).queryByRole('button', {
        name: `Start maintenance for unit ${outUnit().tag}`,
      }),
    ).not.toBeInTheDocument();
  });

  it('offers End maintenance on a unit already in maintenance, and shows its status', async () => {
    const unit = availableUnit();
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          units: [{ ...unit, status: 'MAINTENANCE' }, outUnit()],
        }),
      ),
    );
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });

    // Scoped to the unit's own row, not the whole table: the actions column is *headed*
    // "Maintenance" too, so a table-wide text query would match the header as well and prove nothing
    // about this unit's status.
    const row = within(table).getByRole('row', { name: new RegExp(unit.tag) });
    expect(within(row).getByText('Maintenance')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: `End maintenance for unit ${unit.tag}` }),
    ).toBeInTheDocument();
    // One action per row, and it is the one that applies: a unit in the shop cannot be sent again.
    expect(
      within(table).queryByRole('button', { name: `Start maintenance for unit ${unit.tag}` }),
    ).not.toBeInTheDocument();
  });

  it('sends the unit for repair, then shows it as Maintenance with a notice', async () => {
    const unit = availableUnit();
    let started = false;
    server.use(
      http.post('*/api/assets/:id/units/:unitId/maintenance', () => {
        started = true;
        return HttpResponse.json({ ...unit, status: 'MAINTENANCE' });
      }),
      // The page reloads the asset after the action, so the refreshed read has to reflect it —
      // this is what proves the table shows server state rather than an optimistic guess.
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          units: [{ ...unit, status: started ? 'MAINTENANCE' : 'AVAILABLE' }, outUnit()],
        }),
      ),
    );
    const user = userEvent.setup();
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });

    await user.click(
      within(table).getByRole('button', { name: `Start maintenance for unit ${unit.tag}` }),
    );

    // The whole sentence, not a loose `tag.*maintenance` pattern: the unit's own table row has the
    // text content "xps-001MaintenanceGood…", which matches such a pattern too, so a loose regex
    // would pass whether or not the notice appeared at all.
    expect(
      await screen.findByText(`Unit ${unit.tag} is now in maintenance and cannot be requested.`),
    ).toBeInTheDocument();
    expect(started).toBe(true);
    await waitFor(() => {
      const row = within(screen.getByRole('table', { name: 'Units' })).getByRole('row', {
        name: new RegExp(unit.tag),
      });
      expect(within(row).getByText('Maintenance')).toBeInTheDocument();
    });
  });

  it('explains the API’s refusal rather than the bare status code', async () => {
    server.use(
      http.post('*/api/assets/:id/units/:unitId/maintenance', () =>
        errorResponse(409, 'CONFLICT', 'Only an available unit can be put into maintenance'),
      ),
    );
    const user = userEvent.setup();
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });

    await user.click(
      within(table).getByRole('button', {
        name: `Start maintenance for unit ${availableUnit().tag}`,
      }),
    );

    // The server's own wording, which names the reason, the way onRetire already surfaces it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/only an available unit/i);
  });

  /**
   * The two tests below were written *after* the implementation and passed on their first run —
   * necessarily so. A test asserting that something is *not* on the page cannot fail while nothing
   * puts it there, so neither could ever have been a red. They are here to catch the column being
   * widened later, not as evidence of test-first development.
   *
   * Hiding the controls is presentation, not a security control: `assets:write` is enforced by the API
   * on both routes (SR-1), so a member who reaches them another way gets a 403 rather than an effect.
   */
  it('offers a MEMBER no maintenance actions, while the units stay readable', async () => {
    renderDetail(assets[0].id, { user: memberUser });
    const table = await screen.findByRole('table', { name: 'Units' });

    expect(
      within(table).queryByRole('button', { name: /maintenance for unit/i }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: 'Maintenance' }),
    ).not.toBeInTheDocument();
    // The table itself is still theirs to read, statuses included.
    expect(within(table).getByText('Available')).toBeInTheDocument();
  });

  it('offers no maintenance actions on a retired asset', async () => {
    // Its units may still read AVAILABLE, but the asset is out of circulation — the same reasoning
    // that removes "Request this" and the add-unit form.
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          retiredAt: '2026-09-19T12:00:00.000Z',
          units: assetUnits[assets[0].id],
        }),
      ),
    );
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });

    expect(
      within(table).queryByRole('button', { name: /maintenance for unit/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Restricted equipment (SCRUM-150, AT-4): a restricted asset stays visible, names the groups that may
 * borrow it, and — for someone outside them — disables Request with the reason. The API refuses the
 * request anyway (AT-1); this is what keeps the member from finding that out by trying.
 */
describe('AssetDetailPage — restricted equipment (SCRUM-150)', () => {
  /** Serve assets[0] restricted to the drone pilots, with the caller's eligibility as given. */
  const serveRestricted = (eligible) =>
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          allowedGroupIds: [groups[0].id],
          allowedGroups: [{ id: groups[0].id, name: groups[0].name }],
          restricted: true,
          units: assetUnits[assets[0].id],
          eligible,
        }),
      ),
    );

  it('AT-4: shows a Restricted badge naming the group, and disables Request with an explanation', async () => {
    serveRestricted(false);
    renderDetail(assets[0].id, { user: memberUser });

    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    const explanation = screen.getByText(/only members of certified drone pilots can request/i);
    expect(explanation).toBeInTheDocument();

    const available = assetUnits[assets[0].id].find((u) => u.status === 'AVAILABLE');
    const button = screen.getByRole('button', { name: `Request unit ${available.tag}` });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/only members of certified drone pilots/i);
  });

  it('names every allowed group when there are several', async () => {
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          allowedGroupIds: groups.map((g) => g.id),
          allowedGroups: groups.map((g) => ({ id: g.id, name: g.name })),
          restricted: true,
          units: assetUnits[assets[0].id],
          eligible: false,
        }),
      ),
    );
    renderDetail(assets[0].id, { user: memberUser });

    expect(
      await screen.findByText(
        /only members of certified drone pilots or heavy machinery certified can request/i,
      ),
    ).toBeInTheDocument();
  });

  it('shows the badge but leaves Request enabled for an eligible member', async () => {
    serveRestricted(true);
    renderDetail(assets[0].id, { user: memberUser });

    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByText(/can request this/i)).not.toBeInTheDocument();
    const available = assetUnits[assets[0].id].find((u) => u.status === 'AVAILABLE');
    expect(screen.getByRole('button', { name: `Request unit ${available.tag}` })).toBeEnabled();
  });

  // SCRUM-203: every listed group deleted. Nobody can request it (the API fails closed), so the page
  // must not look open just because there are no group names left to show.
  it('stays marked restricted, with Request disabled, when every allowed group was deleted', async () => {
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          allowedGroupIds: ['6aab2a45c6e457e01ac09aff'],
          allowedGroups: [],
          restricted: true,
          units: assetUnits[assets[0].id],
          eligible: false,
        }),
      ),
    );
    renderDetail(assets[0].id, { user: memberUser });

    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText(/groups that no longer exist/i)).toBeInTheDocument();
    const available = assetUnits[assets[0].id].find((u) => u.status === 'AVAILABLE');
    const button = screen.getByRole('button', { name: `Request unit ${available.tag}` });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/groups that no longer exist/i);
  });

  it('shows no badge on an unrestricted asset', async () => {
    renderDetail(assets[0].id, { user: memberUser });

    await screen.findByRole('heading', { level: 1, name: assets[0].name });
    expect(screen.queryByText('Restricted')).not.toBeInTheDocument();
  });
});

/**
 * SCRUM-151 subtask SCRUM-186: the page decides whether a member is at a dead end.
 *
 * The section itself is tested in SimilarItems.test.jsx. What belongs here is the condition, because
 * the page is the only thing that already knows the asset's units and can answer it without a second
 * request.
 */
describe('AssetDetailPage — similar items available now (SCRUM-151)', () => {
  const sectionName = 'Similar items available now';

  it('offers alternatives when no unit is available, and asks only then', async () => {
    // assets[1] is the Canon EOS R6 with a single HELD unit: the story's own dead end.
    let asked = 0;
    server.use(
      http.get('*/api/assets/:id/alternatives', () => {
        asked += 1;
        return HttpResponse.json(similarItems);
      }),
    );

    renderDetail(assets[1].id, { user: memberUser });

    const section = await screen.findByRole('region', { name: sectionName });
    expect(within(section).getByText(similarItems.alternatives[0].name)).toBeInTheDocument();
    expect(asked).toBe(1);
  });

  it('offers nothing, and asks nothing, while a unit is still available', async () => {
    // assets[0] has an AVAILABLE unit, so the member is not stuck. Asserting the *request* count is
    // the point: the backend would answer an empty list either way, and a section that merely
    // rendered nothing would still have cost a round trip on every asset page view (AT-4).
    let asked = 0;
    server.use(
      http.get('*/api/assets/:id/alternatives', () => {
        asked += 1;
        return HttpResponse.json(similarItems);
      }),
    );

    renderDetail(assets[0].id, { user: memberUser });

    await screen.findByRole('table', { name: 'Units' });
    expect(screen.queryByRole('region', { name: sectionName })).not.toBeInTheDocument();
    expect(asked).toBe(0);
  });
});

describe('AssetDetailPage layout (UI rework)', () => {
  it('shows the description and availability in the details panel', async () => {
    renderDetail(assets[0].id);
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByText(assets[0].description)).toBeInTheDocument();
    const units = assetUnits[assets[0].id];
    const available = units.filter((u) => u.status === 'AVAILABLE').length;
    expect(details).toHaveTextContent(`${available} of ${units.length} units available`);
  });

  it('brings a unit back from maintenance and says so, and the notice can be dismissed', async () => {
    const unit = assetUnits[assets[0].id][0];
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({ ...assets[0], units: [{ ...unit, status: 'MAINTENANCE' }] }),
      ),
    );
    const user = userEvent.setup();
    renderDetail(assets[0].id);
    await user.click(
      await screen.findByRole('button', { name: `End maintenance for unit ${unit.tag}` }),
    );
    expect(await screen.findByText(`Unit ${unit.tag} is back in circulation.`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(`Unit ${unit.tag} is back in circulation.`)).not.toBeInTheDocument();
  });

  it('says nobody can request an asset whose groups were all deleted', async () => {
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({
          ...assets[0],
          restricted: true,
          allowedGroups: [],
          eligible: false,
          units: assetUnits[assets[0].id],
        }),
      ),
    );
    renderDetail(assets[0].id);
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByText('Nobody (its groups were deleted)')).toBeInTheDocument();
  });

  it('pages a long list of units ten at a time', async () => {
    const template = assetUnits[assets[0].id][0];
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...template,
      id: `unit-${i}`,
      tag: `bulk-${String(i).padStart(2, '0')}`,
    }));
    server.use(
      http.get('*/api/assets/:id', () => HttpResponse.json({ ...assets[0], units: many })),
    );
    const user = userEvent.setup();
    renderDetail(assets[0].id);
    const table = await screen.findByRole('table', { name: 'Units' });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(10);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Units pages' })).getByRole('button', {
        name: 'Next',
      }),
    );
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2);
  });
});

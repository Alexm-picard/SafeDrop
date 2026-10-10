// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-122 ticket)
// AI-Assisted Areas: AssetFormPage tests — create success and error path, edit prefill and PATCH, cancel; group picker (SCRUM-150, SCRUM-176)
// Human Contributions: reviewed and approved by Alex Picard (PR #31, 2026-09-20); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Follows the patterns in MembersPage.test.jsx (MSW overrides, renderWithAuth). Reviewed before merge; see Human Contributions.

/**
 * Tests for the asset create and edit form (SCRUM-122).
 *
 * The acceptance criterion the ticket names explicitly is the **create form's error path**: a 400
 * from the API must land beside the field that caused it, not in a banner. That is the first test
 * here, and it asserts the accessibility wiring (`aria-invalid`, `aria-describedby`) as well as the
 * text, because a message a screen reader never associates with its input is not a field error.
 *
 * The other cases are the ones that would silently break the form: an empty image URL must go to the
 * API as `null` rather than `""` (the schema is `z.url().nullable()`, and `""` is not a URL), and
 * edit mode must prefill from the asset and PATCH rather than POST.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AssetFormPage } from '../../../src/pages/AssetFormPage';
import { adminUser, assets, errorResponse, groups } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** Mount the create form at its own route. */
function renderCreate() {
  return renderWithAuth(<AssetFormPage />, {
    user: adminUser,
    route: '/admin/assets/new',
    extraRoutes: [
      { path: '/admin/assets/new', element: <AssetFormPage /> },
      { path: '/assets/:id', element: <h1>Asset detail</h1> },
      { path: '/catalog', element: <h1>Catalog</h1> },
    ],
  });
}

/** Mount the edit form for the first fixture asset. */
function renderEdit(id = assets[0].id) {
  return renderWithAuth(<AssetFormPage />, {
    user: adminUser,
    route: `/assets/${id}/edit`,
    extraRoutes: [
      { path: '/assets/:id/edit', element: <AssetFormPage /> },
      { path: '/assets/:id', element: <h1>Asset detail</h1> },
    ],
  });
}

describe('AssetFormPage — create', () => {
  it('renders a field-level error from the API next to the matching input', async () => {
    server.use(
      http.post('*/api/assets', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name is already taken' },
          { path: 'category', message: 'Category is required' },
        ]),
      ),
    );
    renderCreate();

    await userEvent.type(screen.getByLabelText('Name'), 'Dell XPS 15');
    await userEvent.type(screen.getByLabelText('Category'), 'laptop');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    const nameError = await screen.findByText('Name is already taken');
    expect(nameError).toBeInTheDocument();
    expect(screen.getByText('Category is required')).toBeInTheDocument();

    // The message must be wired to its input, or a screen reader never reads the two together.
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput.getAttribute('aria-describedby')).toContain(nameError.id);

    // A field-level failure is not also a banner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // And the form is usable again rather than stuck pending.
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeEnabled();
  });

  it('shows a general error in a banner when the failure belongs to no field', async () => {
    server.use(
      http.post('*/api/assets', () => errorResponse(500, 'INTERNAL', 'Something went wrong')),
    );
    renderCreate();

    await userEvent.type(screen.getByLabelText('Name'), 'Projector');
    await userEvent.type(screen.getByLabelText('Category'), 'projector');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('sends a blank image URL as null and lands on the new asset', async () => {
    let sent;
    server.use(
      http.post('*/api/assets', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...sent, id: assets[0].id, retiredAt: null }, { status: 201 });
      }),
    );
    const { router } = renderCreate();

    await userEvent.type(screen.getByLabelText('Name'), '  Canon EOS R6  ');
    await userEvent.type(screen.getByLabelText('Category'), 'camera');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => expect(sent).toBeDefined());
    // `""` would fail `z.url()` on a field the admin deliberately left blank.
    expect(sent.imageUrl).toBeNull();
    // Values are trimmed, so what is stored is what the schema would have trimmed to anyway.
    expect(sent.name).toBe('Canon EOS R6');
    expect(sent.description).toBe('');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/assets/${assets[0].id}`));
  });

  it('cancels back to the catalog without calling the API', async () => {
    let called = false;
    server.use(
      http.post('*/api/assets', () => {
        called = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { router } = renderCreate();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/catalog'));
    expect(called).toBe(false);
  });
});

describe('AssetFormPage — edit', () => {
  it('prefills from the asset and PATCHes only to that id', async () => {
    let patched;
    server.use(
      http.patch('*/api/assets/:id', async ({ params, request }) => {
        patched = { id: params.id, body: await request.json() };
        return HttpResponse.json({ ...assets[0], ...patched.body });
      }),
    );
    const { router } = renderEdit();

    // Waits for the asset to load rather than asserting on an empty form.
    const name = await screen.findByDisplayValue(assets[0].name);
    expect(name).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toHaveValue(assets[0].category);
    expect(screen.getByLabelText('Description')).toHaveValue(assets[0].description);

    await userEvent.clear(name);
    await userEvent.type(name, 'Dell XPS 17');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched.id).toBe(assets[0].id);
    expect(patched.body.name).toBe('Dell XPS 17');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/assets/${assets[0].id}`));
  });

  it('renders ErrorState when the asset cannot be loaded', async () => {
    server.use(
      http.get('*/api/assets/:id', () => errorResponse(404, 'NOT_FOUND', 'Asset not found')),
    );
    renderEdit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Asset not found');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });
});

describe('AssetFormPage — checkout approval (SCRUM-148)', () => {
  it('a new asset uses the organization default unless the admin picks otherwise', async () => {
    let sent;
    server.use(
      http.post('*/api/assets', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...sent, id: assets[0].id, retiredAt: null }, { status: 201 });
      }),
    );
    renderCreate();

    expect(screen.getByLabelText('Checkout approval')).toHaveValue('INHERIT');
    await userEvent.type(screen.getByLabelText('Name'), 'HDMI cable');
    await userEvent.type(screen.getByLabelText('Category'), 'cable');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent.approvalMode).toBe('INHERIT');
  });

  it('sends the override an admin picks when editing', async () => {
    let patched;
    server.use(
      http.patch('*/api/assets/:id', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...assets[0], ...patched });
      }),
    );
    renderEdit();

    const select = await screen.findByLabelText('Checkout approval');
    // The fixture asset predates SCRUM-148 and has no approvalMode: it shows as the default.
    expect(select).toHaveValue('INHERIT');
    await userEvent.selectOptions(select, 'Always approve automatically');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched.approvalMode).toBe('AUTO');
  });
});

/**
 * The group picker (SCRUM-150, SCRUM-176): an admin restricts an asset to any of the organisation's
 * groups. Ticking none leaves it open to everyone; ticking several means membership of any one is
 * enough.
 */
describe('AssetFormPage — restricting to groups (SCRUM-150)', () => {
  it('offers every group, none ticked, and sends an empty list when left alone', async () => {
    let sent;
    server.use(
      http.post('*/api/assets', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ id: 'new-id', ...sent }, { status: 201 });
      }),
    );
    renderCreate();

    const picker = await screen.findByRole('group', { name: /who can request this/i });
    for (const group of groups) {
      expect(within(picker).getByRole('checkbox', { name: group.name })).not.toBeChecked();
    }
    await userEvent.type(screen.getByLabelText('Name'), 'HDMI cable');
    await userEvent.type(screen.getByLabelText('Category'), 'cable');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent.allowedGroupIds).toEqual([]);
  });

  it('sends every group the admin ticks', async () => {
    let sent;
    server.use(
      http.post('*/api/assets', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ id: 'new-id', ...sent }, { status: 201 });
      }),
    );
    renderCreate();

    await userEvent.type(screen.getByLabelText('Name'), 'Forklift');
    await userEvent.type(screen.getByLabelText('Category'), 'machinery');
    await userEvent.click(await screen.findByRole('checkbox', { name: groups[0].name }));
    await userEvent.click(screen.getByRole('checkbox', { name: groups[1].name }));
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent.allowedGroupIds).toEqual([groups[0].id, groups[1].id]);
  });

  it('prefills the groups an asset is restricted to, and can clear them', async () => {
    let patched;
    server.use(
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({ ...assets[0], allowedGroupIds: [groups[1].id], units: [] }),
      ),
      http.patch('*/api/assets/:id', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...assets[0], ...patched });
      }),
    );
    renderEdit();

    const ticked = await screen.findByRole('checkbox', { name: groups[1].name });
    expect(ticked).toBeChecked();
    expect(screen.getByRole('checkbox', { name: groups[0].name })).not.toBeChecked();
    await userEvent.click(ticked);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched.allowedGroupIds).toEqual([]);
  });

  it('shows the API’s refusal of a group under the picker', async () => {
    server.use(
      http.post('*/api/assets', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          {
            location: 'body',
            path: 'allowedGroupIds',
            message: 'No such group in this organisation',
          },
        ]),
      ),
    );
    renderCreate();

    await userEvent.type(screen.getByLabelText('Name'), 'Drone');
    await userEvent.type(screen.getByLabelText('Category'), 'drone');
    await userEvent.click(await screen.findByRole('checkbox', { name: groups[0].name }));
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));

    const picker = screen.getByRole('group', { name: /who can request this/i });
    expect(
      await within(picker).findByText('No such group in this organisation'),
    ).toBeInTheDocument();
  });

  it('says so when the organisation has no groups, and the asset stays open', async () => {
    server.use(
      http.get('*/api/groups', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 100 }),
      ),
    );
    renderCreate();

    expect(await screen.findByText(/no groups yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps an asset’s existing restriction when the groups cannot be loaded', async () => {
    let patched;
    server.use(
      http.get('*/api/groups', () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')),
      http.get('*/api/assets/:id', () =>
        HttpResponse.json({ ...assets[0], allowedGroupIds: [groups[0].id], units: [] }),
      ),
      http.patch('*/api/assets/:id', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...assets[0], ...patched });
      }),
    );
    renderEdit();

    expect(await screen.findByText(/could not load the groups/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched.allowedGroupIds).toEqual([groups[0].id]);
  });
});

describe('AssetFormPage — catalog preview (SCRUM-241)', () => {
  it('draws the catalog card from the form as it is typed', async () => {
    renderCreate();
    const preview = await screen.findByRole('complementary', { name: 'Catalog preview' });
    expect(within(preview).getByRole('heading', { name: 'Untitled asset' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Drone B');
    await userEvent.type(screen.getByLabelText('Category'), 'drone');

    expect(within(preview).getByRole('heading', { name: 'Drone B' })).toBeInTheDocument();
    expect(within(preview).getByText('drone')).toBeInTheDocument();
    expect(within(preview).getByText('Everyone in the organization can request it.')).toBeVisible();
  });

  it('badges the preview and names the groups once the asset is restricted', async () => {
    renderCreate();
    const preview = await screen.findByRole('complementary', { name: 'Catalog preview' });
    await userEvent.click(await screen.findByRole('checkbox', { name: groups[0].name }));
    expect(within(preview).getByText('Restricted')).toBeInTheDocument();
    expect(
      within(preview).getByText(`Only members of ${groups[0].name} can request it.`),
    ).toBeInTheDocument();
  });
});

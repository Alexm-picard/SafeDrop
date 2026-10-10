// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-167 / SCRUM-169)
// AI-Assisted Areas: GroupsPage tests — the list, its empty and error states, creating a group, and the duplicate-name error
// Human Contributions: pending team review
// Notes: Follows the patterns in MembersPage.test.jsx and AssetFormPage.test.jsx (MSW overrides, renderWithAuth). Must be reviewed by the owning team member before merge.

/**
 * Tests for the Groups screen's list and create form (SCRUM-167, SCRUM-169).
 *
 * The duplicate-name case carries the most weight: the API answers 409 with `details.field = 'name'`
 * (SCRUM-149 AT-4), and that has to land under the name input, where the admin can fix it.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { GroupsPage } from '../../../src/pages/GroupsPage';
import { adminUser, assets, errorResponse, groups, memberUser } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

const renderGroups = () =>
  renderWithAuth(<GroupsPage />, {
    user: adminUser,
    route: '/admin/groups',
    extraRoutes: [
      { path: '/admin/groups', element: <GroupsPage /> },
      { path: '/admin/groups/:id', element: <h1>Group detail</h1> },
    ],
  });

/** Open the create panel. */
async function openCreate(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: 'New group' }));
  return screen.findByRole('dialog', { name: 'Create a group' });
}

describe('GroupsPage', () => {
  it('lists the groups with their member counts, each linking to its page', async () => {
    renderGroups();

    const table = await screen.findByRole('table', { name: 'Groups in your organization' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(groups.length + 1);
    const first = within(table).getByRole('link', { name: new RegExp(groups[0].name) });
    expect(first).toHaveAttribute('href', `/admin/groups/${groups[0].id}`);
    expect(first).toHaveTextContent('1 member');
    expect(within(table).getByRole('link', { name: new RegExp(groups[1].name) })).toHaveTextContent(
      '0 members',
    );
  });

  it('shows who is in which group as pressed pegs', async () => {
    renderGroups();
    expect(
      await screen.findByRole('button', { name: `${memberUser.name} in ${groups[0].name}` }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: `${memberUser.name} in ${groups[1].name}` }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds someone to a group from the grid, says so and reloads', async () => {
    const added = [];
    server.use(
      http.post('*/api/groups/:id/members', async ({ params, request }) => {
        added.push({ group: params.id, ...(await request.json()) });
        return HttpResponse.json({ group: { ...groups[1], memberIds: [memberUser.id] } });
      }),
    );
    const user = userEvent.setup();
    renderGroups();
    await user.click(
      await screen.findByRole('button', { name: `${memberUser.name} in ${groups[1].name}` }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      `Added ${memberUser.name} to ${groups[1].name}.`,
    );
    expect(added).toEqual([{ group: groups[1].id, userId: memberUser.id }]);
  });

  it('removes someone from a group from the grid', async () => {
    const removed = [];
    server.use(
      http.delete('*/api/groups/:id/members/:userId', ({ params }) => {
        removed.push(params);
        return HttpResponse.json({ group: { ...groups[0], memberIds: [] } });
      }),
    );
    const user = userEvent.setup();
    renderGroups();
    await user.click(
      await screen.findByRole('button', { name: `${memberUser.name} in ${groups[0].name}` }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      `Removed ${memberUser.name} from ${groups[0].name}.`,
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ id: groups[0].id, userId: memberUser.id });
  });

  it("names each group's restricted equipment and says who can borrow what", async () => {
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
          limit: 100,
        }),
      ),
    );
    renderGroups();
    const table = await screen.findByRole('table', { name: 'Groups in your organization' });
    expect(await within(table).findByRole('link', { name: assets[0].name })).toHaveAttribute(
      'href',
      `/assets/${assets[0].id}`,
    );
    const access = screen.getByRole('region', { name: 'Who can borrow what' });
    expect(within(access).getByRole('link', { name: assets[0].name })).toBeInTheDocument();
    expect(access).toHaveTextContent('1 other asset');
  });

  it('shows an explicit empty state when there are no groups yet', async () => {
    server.use(
      http.get('*/api/groups', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, limit: 100 }),
      ),
    );
    renderGroups();

    expect(await screen.findByText(/no groups yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders ErrorState when the list cannot be loaded', async () => {
    server.use(
      http.get('*/api/groups', () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')),
    );
    renderGroups();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the groups');
  });

  it('creates a group and opens it, so members can be added next', async () => {
    let sent;
    server.use(
      http.post('*/api/groups', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          { group: { id: 'new-group', ...sent, memberIds: [], memberCount: 0 } },
          { status: 201 },
        );
      }),
    );
    renderGroups();
    await openCreate();

    await userEvent.type(await screen.findByLabelText('Name'), '  Film Dept Staff ');
    await userEvent.type(screen.getByLabelText('Description'), 'Faculty and TAs');
    await userEvent.click(screen.getByRole('button', { name: 'Create group' }));

    expect(await screen.findByRole('heading', { name: 'Group detail' })).toBeInTheDocument();
    expect(sent).toEqual({ name: 'Film Dept Staff', description: 'Faculty and TAs' });
  });

  it('shows a duplicate name under the name input (AT-4)', async () => {
    server.use(
      http.post('*/api/groups', () =>
        errorResponse(
          409,
          'CONFLICT',
          'A group with this name already exists in your organisation',
          {
            field: 'name',
          },
        ),
      ),
    );
    renderGroups();
    await openCreate();

    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, 'certified drone pilots');
    await userEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/already exists/i);
  });
});

describe('GroupsPage messages (UI rework)', () => {
  it('shows a failed create that is not about one field as a message on the form', async () => {
    server.use(
      http.post('*/api/groups', () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')),
    );
    const user = userEvent.setup();
    renderGroups();
    await openCreate(user);
    await user.type(await screen.findByLabelText('Name'), 'Film Dept Staff');
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    const form = screen.getByRole('form', { name: 'Create a group' });
    expect(await within(form).findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('shows what the group page did before sending the admin back, until dismissed', async () => {
    const user = userEvent.setup();
    renderWithAuth(<GroupsPage />, {
      user: adminUser,
      route: { pathname: '/admin/groups', state: { notice: 'Deleted Film Dept Staff.' } },
      extraRoutes: [{ path: '/admin/groups', element: <GroupsPage /> }],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted Film Dept Staff.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Deleted Film Dept Staff.')).not.toBeInTheDocument();
  });

  it('opens the create form in a side panel that Escape closes', async () => {
    const user = userEvent.setup();
    renderGroups();
    await openCreate(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

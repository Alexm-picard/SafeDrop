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
import { adminUser, errorResponse, groups } from '../../mocks/handlers';
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

describe('GroupsPage', () => {
  it('lists the groups with their member counts, each linking to its page', async () => {
    renderGroups();

    const table = await screen.findByRole('table', { name: /groups/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(groups.length);
    expect(within(rows[0]).getByRole('link', { name: groups[0].name })).toHaveAttribute(
      'href',
      `/admin/groups/${groups[0].id}`,
    );
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0')).toBeInTheDocument();
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

    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, 'certified drone pilots');
    await userEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/already exists/i);
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-167 / SCRUM-169)
// AI-Assisted Areas: GroupDetailPage tests — members, adding and removing a member, renaming (incl. duplicate name), deleting
// Human Contributions: pending team review
// Notes: Follows the patterns in AssetDetailPage.test.jsx (route params through extraRoutes, MSW overrides). Must be reviewed by the owning team member before merge.

/**
 * Tests for one group's page (SCRUM-167, SCRUM-169): who is in it, adding and removing members,
 * renaming it, and deleting it.
 *
 * The membership tests keep a little state in the overriding handlers, because the add and remove
 * routes answer without resolved member names and the page re-reads the group to show the change —
 * so a stateless mock would hide whether the reload happened.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { GroupDetailPage } from '../../../src/pages/GroupDetailPage';
import {
  adminUser,
  approverUser,
  errorResponse,
  groups,
  groupWithMembers,
  memberUser,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

const group = groups[0];

const renderDetail = (id = group.id) =>
  renderWithAuth(<GroupDetailPage />, {
    user: adminUser,
    route: `/admin/groups/${id}`,
    extraRoutes: [
      { path: '/admin/groups/:id', element: <GroupDetailPage /> },
      { path: '/admin/groups', element: <h1>All groups</h1> },
    ],
  });

/** Serve `group` from a mutable member list, so adds and removes show up on the re-read. */
function statefulGroup(memberIds) {
  const state = { memberIds: [...memberIds] };
  server.use(
    http.get('*/api/groups/:id', () =>
      HttpResponse.json({ group: groupWithMembers({ ...group, memberIds: state.memberIds }) }),
    ),
    http.post('*/api/groups/:id/members', async ({ request }) => {
      const { userId } = await request.json();
      state.memberIds = [...state.memberIds, userId];
      return HttpResponse.json({ group: { ...group, memberIds: state.memberIds } });
    }),
    http.delete('*/api/groups/:id/members/:userId', ({ params }) => {
      state.memberIds = state.memberIds.filter((id) => id !== params.userId);
      return HttpResponse.json({ group: { ...group, memberIds: state.memberIds } });
    }),
  );
  return state;
}

describe('GroupDetailPage', () => {
  it('shows the group and its members', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: group.name })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /members/i });
    expect(within(table).getByText(memberUser.name)).toBeInTheDocument();
    expect(within(table).getByText(memberUser.email)).toBeInTheDocument();
  });

  it('marks a deactivated member, who stays listed but cannot request anything', async () => {
    server.use(
      http.get('*/api/groups/:id', () => {
        const withMembers = groupWithMembers(group);
        withMembers.members[0].deactivatedAt = '2026-10-01T00:00:00.000Z';
        return HttpResponse.json({ group: withMembers });
      }),
    );
    renderDetail();

    const table = await screen.findByRole('table', { name: /members/i });
    expect(within(table).getByText('Deactivated')).toBeInTheDocument();
  });

  it('renders ErrorState for a group that does not exist (404)', async () => {
    renderDetail('6aab2a45c6e457e01ac09aff');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this group');
  });

  it('adds a member chosen from the organisation, then shows them in the list (AT-1)', async () => {
    const state = statefulGroup([memberUser.id]);
    renderDetail();

    const select = await screen.findByLabelText('Member to add');
    // Someone already in the group is not offered again.
    expect(within(select).queryByRole('option', { name: /max member/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, approverUser.id);
    await userEvent.click(screen.getByRole('button', { name: 'Add to group' }));

    const table = screen.getByRole('table', { name: /members/i });
    expect(await within(table).findByText(approverUser.name)).toBeInTheDocument();
    expect(state.memberIds).toEqual([memberUser.id, approverUser.id]);
    expect(await screen.findByRole('status')).toHaveTextContent(`Added ${approverUser.name}`);
  });

  it('removes a member and takes them off the list', async () => {
    const state = statefulGroup([memberUser.id]);
    renderDetail();

    await userEvent.click(
      await screen.findByRole('button', { name: `Remove ${memberUser.name} from the group` }),
    );

    await waitFor(() => expect(screen.queryByText(memberUser.email)).not.toBeInTheDocument());
    expect(state.memberIds).toEqual([]);
    expect(screen.getByText(/nobody is in this group yet/i)).toBeInTheDocument();
  });

  it('renames the group', async () => {
    let patched;
    server.use(
      http.patch('*/api/groups/:id', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ group: { ...group, ...patched } });
      }),
    );
    renderDetail();

    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Drone Pilots (Level 2)');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched).toEqual({ name: 'Drone Pilots (Level 2)', description: group.description });
    expect(await screen.findByRole('status')).toHaveTextContent('Group updated');
  });

  it('shows a duplicate name under the name input when renaming (AT-4)', async () => {
    server.use(
      http.patch('*/api/groups/:id', () =>
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
    renderDetail();

    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, groups[1].name);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/already exists/i);
  });

  it('deletes the group only after confirmation, then returns to the list', async () => {
    let deleted = false;
    server.use(
      http.delete('*/api/groups/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete group' }));
    expect(deleted).toBe(false);
    // The prompt says what happens to equipment restricted to this group (SCRUM-204): here, nothing.
    expect(screen.getByText(/no equipment is restricted to it/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));

    expect(await screen.findByRole('heading', { name: 'All groups' })).toBeInTheDocument();
    expect(deleted).toBe(true);
  });

  /**
   * SCRUM-204: the equipment this group restricts, and which of it deleting the group would leave
   * requestable by nobody (where this is the asset's only group).
   */
  describe('restricted equipment (SCRUM-204)', () => {
    const serveWithAssets = (restrictedAssets) =>
      server.use(
        http.get('*/api/groups/:id', () =>
          HttpResponse.json({ group: { ...groupWithMembers(group), restrictedAssets } }),
        ),
      );
    const drone = { id: '6aab2a45c6e457e01ac0971d', name: 'DJI Mavic 3', onlyGroup: true };
    const camera = { id: '6aab2a45c6e457e01ac0971e', name: 'Cinema Camera', onlyGroup: false };

    it('lists the equipment restricted to the group, each linking to the asset', async () => {
      serveWithAssets([camera, drone]);
      renderDetail();

      const list = await screen.findByRole('list', { name: /equipment restricted to this group/i });
      expect(within(list).getByRole('link', { name: drone.name })).toHaveAttribute(
        'href',
        `/assets/${drone.id}`,
      );
      expect(within(list).getByRole('link', { name: camera.name })).toBeInTheDocument();
      expect(within(list).getByText(/only this group/i)).toBeInTheDocument();
    });

    it('says when no equipment is restricted to the group', async () => {
      renderDetail();

      expect(
        await screen.findByText(/no equipment is restricted to this group/i),
      ).toBeInTheDocument();
    });

    it('the delete confirmation names the equipment that would be left requestable by nobody', async () => {
      serveWithAssets([camera, drone]);
      renderDetail();

      await userEvent.click(await screen.findByRole('button', { name: 'Delete group' }));

      const prompt = screen.getByText(/nobody will be able to request/i);
      expect(prompt).toHaveTextContent(drone.name);
      expect(prompt).not.toHaveTextContent(camera.name);
    });

    it('the delete confirmation says other groups keep access when no asset depends on this one alone', async () => {
      serveWithAssets([camera]);
      renderDetail();

      await userEvent.click(await screen.findByRole('button', { name: 'Delete group' }));

      expect(
        screen.getByText(/stays available to the members of its other groups/i),
      ).toBeInTheDocument();
    });
  });
});

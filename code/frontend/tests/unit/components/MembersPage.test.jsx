// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen tests: list with invitation status, invite (delivery-aware notices, no password anywhere), resend invitation, field-level errors, role change, failure paths, pagination
// Human Contributions: pending team review
// Notes: Runs against the MSW mock of the real API contract. Must be reviewed by the owning team member before merge.

/**
 * Tests for the members screen (member-lifecycle ticket).
 *
 * Many of these assert on the *request* the page sends as well as what it renders, because the
 * interesting failures are on the wire: an invitation that smuggled a password field would let an admin
 * choose a member's password, and a role change that never reaches the server would still look right on
 * screen until the next reload.
 *
 * The invitation tests are the ones to keep if any are trimmed. The admin must have no way to choose or
 * see a member's password, and nothing that would let them (the link, a token) may appear on the page.
 * What the page does report is how the email went, and the three outcomes need different wording: sent,
 * not sent because the server has no mail configured, and failed — where the way out is Resend.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { MembersPage } from '../../../src/pages/MembersPage';
import {
  adminUser,
  approverUser,
  errorResponse,
  memberUser,
  members,
  membersPage,
} from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';

/** Query strings the page has sent to `GET /api/users`, oldest first. */
let listRequests = [];
/** Bodies the page has sent to `POST /api/users/invite`. */
let inviteBodies = [];
/** `{ id, role }` for each `PATCH /api/users/:id/role` the page has sent. */
let roleChanges = [];

beforeEach(() => {
  listRequests = [];
  inviteBodies = [];
  roleChanges = [];
  server.use(
    http.get('*/api/users', ({ request }) => {
      const url = new URL(request.url);
      listRequests.push(url.searchParams);
      return HttpResponse.json(membersPage(url.searchParams));
    }),
    http.post('*/api/users/invite', async ({ request }) => {
      const body = await request.json();
      inviteBodies.push(body);
      return HttpResponse.json(
        {
          user: {
            id: '6aab2a45c6e457e01ac0968e',
            orgId: adminUser.orgId,
            email: body.email,
            name: body.name,
            role: body.role,
            invitation: { status: 'PENDING', expiresAt: '2026-09-13T00:00:00.000Z' },
            createdAt: '2026-09-10T00:00:00.000Z',
          },
          delivery: 'email',
        },
        { status: 201 },
      );
    }),
    http.patch('*/api/users/:id/role', async ({ params, request }) => {
      const { role } = await request.json();
      roleChanges.push({ id: params.id, role });
      const target = members.find((m) => m.id === params.id);
      return HttpResponse.json({ user: { ...target, role } });
    }),
  );
});

/** Body rows currently rendered, excluding the header row. */
const dataRows = () => screen.getAllByRole('row').slice(1);

/** Render the page as the admin and wait for the list. */
async function renderLoaded() {
  const utils = renderWithAuth(<MembersPage />, { user: adminUser });
  await screen.findByRole('table');
  return utils;
}

/** Fill the invite form; every field is optional so a test sets only what it cares about. */
async function fillInvite(user, { name, email, role } = {}) {
  if (name !== undefined) {
    await user.type(screen.getByLabelText('Name'), name);
  }
  if (email !== undefined) {
    await user.type(screen.getByLabelText('Email'), email);
  }
  if (role !== undefined) {
    await user.selectOptions(screen.getByLabelText('Role'), role);
  }
}

describe('MembersPage: the list', () => {
  it('shows a loading state, then the organisation’s members with their roles', async () => {
    renderWithAuth(<MembersPage />, { user: adminUser });
    expect(screen.getByRole('status')).toHaveTextContent(/loading members/i);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(3);
    expect(screen.getByText('ann@acme.test')).toBeInTheDocument();
    // Roles are shown by their display name, never as ORG_ADMIN.
    expect(screen.queryByText('ORG_ADMIN')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role for Ann Approver')).toHaveValue('APPROVER');
    expect(screen.getByLabelText('Role for Max Member')).toHaveValue('MEMBER');
  });

  it('marks the signed-in admin as "(you)" and gives them no role control', async () => {
    await renderLoaded();
    const own = within(dataRows()[0]);
    expect(own.getByText(/\(you\)/)).toBeInTheDocument();
    expect(own.getByText('Organization admin')).toBeInTheDocument();
    expect(own.queryByRole('combobox')).not.toBeInTheDocument();
    // Everyone else can be changed.
    expect(within(dataRows()[1]).getByRole('combobox')).toBeInTheDocument();
  });

  it('shows who is active, who has a pending invitation and when it expires, and whose expired', async () => {
    const pending = {
      ...memberUser,
      invitation: { status: 'PENDING', expiresAt: '2026-09-13T15:00:00.000Z' },
    };
    const expired = {
      ...approverUser,
      invitation: { status: 'EXPIRED', expiresAt: '2026-09-01T15:00:00.000Z' },
    };
    server.use(
      http.get('*/api/users', ({ request }) =>
        HttpResponse.json(
          membersPage(new URL(request.url).searchParams, [adminUser, pending, expired]),
        ),
      ),
    );
    renderWithAuth(<MembersPage />, { user: adminUser });
    await screen.findByRole('table');
    expect(within(dataRows()[0]).getByText('Active')).toBeInTheDocument();
    expect(within(dataRows()[1]).getByText(/Invited · link expires/)).toBeInTheDocument();
    expect(within(dataRows()[2]).getByText('Invitation expired')).toBeInTheDocument();
  });

  it('offers to resend an invitation only to members who have not accepted', async () => {
    const pending = {
      ...memberUser,
      invitation: { status: 'PENDING', expiresAt: '2026-09-13T15:00:00.000Z' },
    };
    server.use(
      http.get('*/api/users', ({ request }) =>
        HttpResponse.json(membersPage(new URL(request.url).searchParams, [adminUser, pending])),
      ),
    );
    renderWithAuth(<MembersPage />, { user: adminUser });
    await screen.findByRole('table');
    expect(
      within(dataRows()[1]).getByRole('button', { name: 'Resend invitation to Max Member' }),
    ).toBeInTheDocument();
    expect(within(dataRows()[0]).queryByRole('button', { name: /Resend/ })).not.toBeInTheDocument();
  });

  it('requests the first page at the page size', async () => {
    await renderLoaded();
    expect(listRequests[0].get('page')).toBe('1');
    expect(listRequests[0].get('limit')).toBe('25');
  });

  it('pages through a long list', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...memberUser,
      id: `6aab2a45c6e457e01ac09${String(900 + i).padStart(4, '0')}`,
      email: `person${i}@acme.test`,
      name: `Person ${i}`,
    }));
    server.use(
      http.get('*/api/users', ({ request }) => {
        const url = new URL(request.url);
        listRequests.push(url.searchParams);
        return HttpResponse.json(membersPage(url.searchParams, many));
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<MembersPage />, { user: adminUser });
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(25);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect(listRequests.at(-1).get('page')).toBe('2');
    expect(dataRows()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('offers no pagination when everything fits on one page', async () => {
    await renderLoaded();
    expect(screen.queryByRole('navigation', { name: 'Members pages' })).not.toBeInTheDocument();
  });

  it('shows the error and a way to retry when the list cannot be loaded', async () => {
    server.use(http.get('*/api/users', () => errorResponse(500, 'INTERNAL_ERROR', 'Boom')));
    const user = userEvent.setup();
    renderWithAuth(<MembersPage />, { user: adminUser });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the members');

    server.use(
      http.get('*/api/users', ({ request }) =>
        HttpResponse.json(membersPage(new URL(request.url).searchParams)),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('still offers the invite form when the list fails to load', async () => {
    server.use(http.get('*/api/users', () => errorResponse(500, 'INTERNAL_ERROR', 'Boom')));
    renderWithAuth(<MembersPage />, { user: adminUser });
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });
});

describe('MembersPage: inviting', () => {
  it('sends only name, email and role, confirms the email, and refreshes the list', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', role: 'APPROVER' });
    const listCallsBefore = listRequests.length;

    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Invited Nina New as Approver.');
    expect(notice).toHaveTextContent('An invitation was emailed to nina@acme.test.');
    expect(notice).toHaveTextContent(/works once and expires/i);
    expect(notice).toHaveTextContent(/you will never see it/i);

    // No password of any kind goes up: the member chooses their own from the emailed link.
    expect(inviteBodies).toEqual([{ name: 'Nina New', email: 'nina@acme.test', role: 'APPROVER' }]);

    // The list was reloaded, and the form is empty and ready for the next one.
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(listCallsBefore));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Role')).toHaveValue('MEMBER');
  });

  it.each([
    ['log', 'status', /no email was sent because this server has no mail configured/i],
    ['failed', 'alert', /the email could not be sent.*Resend invitation/i],
  ])('says so plainly when the delivery is "%s"', async (delivery, role, message) => {
    server.use(
      http.post('*/api/users/invite', async ({ request }) => {
        const body = await request.json();
        inviteBodies.push(body);
        return HttpResponse.json(
          {
            user: {
              id: '6aab2a45c6e457e01ac0968e',
              orgId: adminUser.orgId,
              ...body,
              invitation: { status: 'PENDING', expiresAt: '2026-09-13T00:00:00.000Z' },
              createdAt: '2026-09-10T00:00:00.000Z',
            },
            delivery,
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    // A failed send is an alert, not a success: the member exists but was never told.
    expect(await screen.findByRole(role)).toHaveTextContent(message);
  });

  it('defaults the new member’s role to the least privileged one', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    expect(screen.getByLabelText('Role')).toHaveValue('MEMBER');
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await screen.findByRole('status');
    expect(inviteBodies[0].role).toBe('MEMBER');
  });

  it('gives the admin no way to choose a member’s password', async () => {
    await renderLoaded();
    const form = screen.getByRole('form', { name: 'Invite a member' });
    expect(within(form).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(form.querySelector('input[type="password"]')).toBeNull();
  });

  it('never shows a link, a token or a password, and stores nothing in the browser', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const notice = await screen.findByRole('status');

    expect(notice.textContent).not.toMatch(/token|accept-invite|password:/i);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a duplicate email beside the email field, not as a banner, and shows no success', async () => {
    server.use(
      http.post('*/api/users/invite', () =>
        errorResponse(
          409,
          'CONFLICT',
          'A member with this email already exists in your organisation',
          { field: 'email' },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Max Again', email: 'max@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(
      screen.getByText('A member with this email already exists in your organisation'),
    ).toHaveAttribute('id', 'email-error');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The admin's input is kept so they can correct it rather than retype it.
    expect(email).toHaveValue('max@acme.test');
    expect(screen.getByLabelText('Name')).toHaveValue('Max Again');
  });

  it('spreads validation errors across the fields they belong to', async () => {
    server.use(
      http.post('*/api/users/invite', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { location: 'body', path: 'email', message: 'Invalid email address' },
          { location: 'body', path: 'name', message: 'Too short' },
        ]),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'N', email: 'nope' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    expect(await screen.findByText('Invalid email address')).toHaveAttribute('id', 'email-error');
    expect(screen.getByText('Too short')).toHaveAttribute('id', 'name-error');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'name-error');
  });

  it('shows an error with no field as a banner in the form', async () => {
    server.use(http.post('*/api/users/invite', () => errorResponse(403, 'FORBIDDEN', 'Forbidden')));
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables the button while the invitation is in flight', async () => {
    let release;
    server.use(
      http.post('*/api/users/invite', async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(
          { user: { ...memberUser, id: 'x'.repeat(24), createdAt: '2026-09-10T00:00:00.000Z' } },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const busy = await screen.findByRole('button', { name: 'Inviting…' });
    expect(busy).toBeDisabled();
    release();
    await screen.findByRole('button', { name: 'Invite member' });
  });
});

describe('MembersPage: resending an invitation', () => {
  const pendingList = () =>
    server.use(
      http.get('*/api/users', ({ request }) => {
        const url = new URL(request.url);
        listRequests.push(url.searchParams);
        return HttpResponse.json(
          membersPage(url.searchParams, [
            adminUser,
            {
              ...memberUser,
              invitation: { status: 'EXPIRED', expiresAt: '2026-09-01T00:00:00.000Z' },
            },
          ]),
        );
      }),
    );

  it('resends to that member, confirms the new email, and refreshes the list', async () => {
    pendingList();
    const resent = [];
    server.use(
      http.post('*/api/users/:id/resend-invite', ({ params }) => {
        resent.push(params.id);
        return HttpResponse.json({
          user: {
            ...memberUser,
            invitation: { status: 'PENDING', expiresAt: '2026-09-16T00:00:00.000Z' },
          },
          delivery: 'email',
        });
      }),
    );
    const user = userEvent.setup();
    await renderLoaded();
    const listCallsBefore = listRequests.length;

    await user.click(screen.getByRole('button', { name: 'Resend invitation to Max Member' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('A new invitation was emailed to max@acme.test.');
    expect(notice).toHaveTextContent(/works once and expires/i);
    expect(resent).toEqual([memberUser.id]);
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(listCallsBefore));
  });

  it('reports a failed send as an error that points at resending again', async () => {
    pendingList();
    server.use(
      http.post('*/api/users/:id/resend-invite', () =>
        HttpResponse.json({
          user: {
            ...memberUser,
            invitation: { status: 'PENDING', expiresAt: '2026-09-16T00:00:00.000Z' },
          },
          delivery: 'failed',
        }),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Resend invitation to Max Member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be sent/i);
  });

  it('shows a refusal, such as the member having already accepted', async () => {
    pendingList();
    server.use(
      http.post('*/api/users/:id/resend-invite', () =>
        errorResponse(409, 'CONFLICT', 'This member has already accepted their invitation'),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Resend invitation to Max Member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already accepted/i);
  });

  it('disables the button while it is sending', async () => {
    pendingList();
    let release;
    server.use(
      http.post('*/api/users/:id/resend-invite', async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return errorResponse(500, 'INTERNAL_ERROR', 'Boom');
      }),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Resend invitation to Max Member' }));
    expect(
      await screen.findByRole('button', { name: 'Resend invitation to Max Member' }),
    ).toBeDisabled();
    release();
    await screen.findByRole('alert');
  });
});

describe('MembersPage: changing a role', () => {
  it('sends the new role for that member, confirms it, and refreshes the list', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const listCallsBefore = listRequests.length;

    await user.selectOptions(screen.getByLabelText('Role for Max Member'), 'APPROVER');

    expect(await screen.findByRole('status')).toHaveTextContent('Max Member is now Approver.');
    expect(roleChanges).toEqual([{ id: memberUser.id, role: 'APPROVER' }]);
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(listCallsBefore));
  });

  it('keeps the list on screen while it refreshes, so the control does not vanish', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const select = screen.getByLabelText('Role for Max Member');
    await user.selectOptions(select, 'APPROVER');
    await screen.findByRole('status');
    // The same DOM element is still there: the table was never swapped for a loading state.
    expect(screen.getByLabelText('Role for Max Member')).toBe(select);
  });

  it('reports a refusal, such as demoting the last admin, and leaves the role as it was', async () => {
    server.use(
      http.patch('*/api/users/:id/role', () =>
        errorResponse(409, 'CONFLICT', 'Cannot demote the last organisation admin', {
          field: 'role',
        }),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(screen.getByLabelText('Role for Ann Approver'), 'MEMBER');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot demote the last organisation admin',
    );
    // The control reflects the server's truth, not the attempted change.
    expect(screen.getByLabelText('Role for Ann Approver')).toHaveValue('APPROVER');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a failure from a network error too', async () => {
    server.use(http.patch('*/api/users/:id/role', () => HttpResponse.error()));
    const user = userEvent.setup();
    await renderLoaded();
    await user.selectOptions(screen.getByLabelText('Role for Ann Approver'), 'MEMBER');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('replaces the previous message rather than stacking them', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.selectOptions(screen.getByLabelText('Role for Max Member'), 'APPROVER');
    await screen.findByText('Max Member is now Approver.');
    await user.selectOptions(screen.getByLabelText('Role for Ann Approver'), 'MEMBER');
    await screen.findByText('Ann Approver is now Member.');
    expect(screen.queryByText('Max Member is now Approver.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('offers exactly the three roles', async () => {
    await renderLoaded();
    const options = within(screen.getByLabelText('Role for Max Member'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Member', 'Approver', 'Organization admin']);
  });
});

describe('MembersPage: whose row has no role control', () => {
  it('omits the control only from the viewer’s own row, whoever the viewer is', async () => {
    renderWithAuth(<MembersPage />, { user: approverUser });
    await screen.findByRole('table');
    // The viewer (here the approver fixture) is the only row without a control.
    expect(screen.getAllByRole('combobox', { name: /^Role for / })).toHaveLength(2);
    expect(screen.queryByLabelText('Role for Ann Approver')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role for Ada Admin')).toHaveValue('ORG_ADMIN');
  });
});

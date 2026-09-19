// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen tests: list, invite (admin-set initial password), field-level errors, role change, failure paths, pagination
// Human Contributions: pending team review
// Notes: Runs against the MSW mock of the real API contract. Must be reviewed by the owning team member before merge.

/**
 * Tests for the members screen (member-lifecycle ticket).
 *
 * Many of these assert on the *request* the page sends as well as what it renders, because the
 * interesting failures are on the wire: an invitation that omitted the initial password would create a
 * member nobody can sign in as, and a role change that never reaches the server would still look right
 * on screen until the next reload.
 *
 * The password tests are the ones to keep if any are trimmed. Iteration 1 has no email service, so the
 * admin sets the member's initial password and shares it out of band. The page must send it, must keep it
 * masked unless the admin asks to see it (they cannot recover from a typo), must clear it the moment the
 * invitation succeeds, and must never show it back — the confirmation tells the admin what they need
 * (the organization code) but not the password.
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
import { formatDate } from '../../../src/utils/format';
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
            createdAt: '2026-09-10T00:00:00.000Z',
          },
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
async function fillInvite(user, { name, email, role, password } = {}) {
  if (name !== undefined) {
    await user.type(screen.getByLabelText('Name'), name);
  }
  if (email !== undefined) {
    await user.type(screen.getByLabelText('Email'), email);
  }
  if (role !== undefined) {
    await user.selectOptions(screen.getByLabelText('Role'), role);
  }
  if (password !== undefined) {
    await user.type(screen.getByLabelText('Initial password'), password);
  }
}

const PASSWORD = 'Initial-Passw0rd-1';

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

  it('shows exactly name, email, role and join date for each member', async () => {
    await renderLoaded();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Role',
      'Joined',
    ]);
    // Oldest first, as the API returns them: the founding admin is at the top.
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'Ada Admin (you)',
      'Ann Approver',
      'Max Member',
    ]);
    // Each row carries that member's email and the date they joined.
    const first = within(dataRows()[0]).getAllByRole('cell');
    expect(first[1]).toHaveTextContent('ada@acme.test');
    expect(first[2]).toHaveTextContent('Organization admin');
    expect(first[3]).toHaveTextContent(formatDate(members[0].createdAt));
    expect(within(dataRows()[2]).getAllByRole('cell')[3]).toHaveTextContent(
      formatDate(members[2].createdAt),
    );
  });

  it('never shows a password or hash: the list has no such data to show', async () => {
    await renderLoaded();
    expect(screen.getByRole('table').textContent).not.toMatch(/password|hash|\$2[aby]\$/i);
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
  it('sends name, email, role and the initial password, then refreshes the list', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, {
      name: 'Nina New',
      email: 'nina@acme.test',
      role: 'APPROVER',
      password: PASSWORD,
    });
    const listCallsBefore = listRequests.length;

    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Invited Nina New as Approver.');
    expect(inviteBodies).toEqual([
      { name: 'Nina New', email: 'nina@acme.test', role: 'APPROVER', password: PASSWORD },
    ]);
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(listCallsBefore));
  });

  it('defaults the new member’s role to the least privileged one', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    expect(screen.getByLabelText('Role')).toHaveValue('MEMBER');
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await screen.findByRole('status');
    expect(inviteBodies[0].role).toBe('MEMBER');
  });

  it('tells the admin how the new member signs in, including the organization code', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const notice = await screen.findByRole('status');
    // A new member has no other way to learn the code that login needs.
    expect(notice).toHaveTextContent('organization code “acme-robotics”');
    expect(notice).toHaveTextContent('nina@acme.test');
    expect(notice).toHaveTextContent(/through a channel you trust/i);
  });

  it('never shows the password back, in the confirmation or anywhere else', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const notice = await screen.findByRole('status');

    expect(notice.textContent).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(screen.queryByDisplayValue(PASSWORD)).not.toBeInTheDocument();
    expect(notice).toHaveTextContent(/password is not shown again/i);
  });

  it('clears the whole form once the invitation succeeds, password included', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await screen.findByRole('status');

    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Initial password')).toHaveValue('');
    expect(screen.getByLabelText('Role')).toHaveValue('MEMBER');
  });

  it('stores the password nowhere in the browser', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await screen.findByRole('status');

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('masks the password by default, and lets the admin reveal it to check what they typed', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const field = screen.getByLabelText('Initial password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'new-password');
    await user.type(field, PASSWORD);

    await user.click(screen.getByLabelText('Show password'));
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveValue(PASSWORD);

    await user.click(screen.getByLabelText('Show password'));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('hides the password again after a successful invitation', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByLabelText('Show password'));
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await screen.findByRole('status');

    expect(screen.getByLabelText('Initial password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Show password')).not.toBeChecked();
  });

  it('keeps the password field on a failed invitation so a duplicate email can be corrected', async () => {
    server.use(
      http.post('*/api/users/invite', () =>
        errorResponse(
          409,
          'CONFLICT',
          'A member with this email already exists in your organisation',
          {
            field: 'email',
          },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Max Again', email: 'max@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    await screen.findByText('A member with this email already exists in your organisation');
    // Nothing was created, so the admin can fix the email without retyping the rest.
    expect(screen.getByLabelText('Initial password')).toHaveValue(PASSWORD);
  });

  it('shows the API’s password rules beside the password field', async () => {
    server.use(
      http.post('*/api/users/invite', () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', [
          { location: 'body', path: 'password', message: 'must be at least 10 characters' },
        ]),
      ),
    );
    const user = userEvent.setup();
    await renderLoaded();
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: 'short' });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    expect(await screen.findByText('must be at least 10 characters')).toHaveAttribute(
      'id',
      'password-error',
    );
    const field = screen.getByLabelText('Initial password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Both the error and the standing hint are announced.
    expect(field.getAttribute('aria-describedby')).toContain('password-error');
    expect(field.getAttribute('aria-describedby')).toContain('password-hint');
  });

  it('has no invitation link or email step: there is nothing to copy or resend', async () => {
    await renderLoaded();
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
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
    await fillInvite(user, { name: 'Max Again', email: 'max@acme.test', password: PASSWORD });
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
    await fillInvite(user, { name: 'N', email: 'nope', password: PASSWORD });
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
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
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
    await fillInvite(user, { name: 'Nina New', email: 'nina@acme.test', password: PASSWORD });
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const busy = await screen.findByRole('button', { name: 'Inviting…' });
    expect(busy).toBeDisabled();
    release();
    await screen.findByRole('button', { name: 'Invite member' });
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

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen: list, invite form (admin-set initial password) with field-level API errors, per-row role change
// Human Contributions: pending team review
// Notes: InviteForm and ResetPasswordForm live in src/components. Follows the patterns in OrgSetupPage (form) and AuditLogPage (list, pagination). Verified by tests/unit/components/MembersPage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * The members screen (ORG_ADMIN only): see who is in the organisation, invite people, change roles.
 *
 * This is what makes the rest of the product demonstrable — until an organisation can have more than
 * its founding admin there is nobody to submit a request or approve one.
 *
 * Three decisions worth knowing:
 *
 * **The admin sets the new member's initial password.** Iteration 1 has no email service, so there is no
 * invitation link: the admin types an initial password for the person and shares it with them through
 * a channel they trust. The form has a Show password option because a typo cannot be recovered from
 * (there is no reset-password feature yet), so the admin needs to be able to check what they typed. The
 * password goes to the API once, is held in component state only, is cleared from the form as soon as the
 * invitation succeeds, and is never shown again — not even in the confirmation. The member signs in with
 * the organization code, their email and that password; the confirmation tells the admin the code,
 * since a new member has no other way to learn it.
 *
 * **You cannot change your own role here.** The API allows it (and refuses only to demote the last
 * admin), but a mis-click that demotes yourself ends your own access to this very screen. Another admin
 * can still do it. This is a usability guard, not a security control; the API enforces the rules.
 *
 * **The list stays on screen while it refreshes.** After an invite or a role change the page reloads
 * the list, but keeps showing the previous rows until the new ones arrive, so the control the admin
 * just used does not vanish from under their keyboard focus.
 */
import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { InviteForm } from '../components/InviteForm';
import { LoadingState } from '../components/LoadingState';
import { ResetPasswordForm } from '../components/ResetPasswordForm';
import { useAuth } from '../hooks/useAuth';
import { useMembers } from '../hooks/useMembers';
import { errorMessage } from '../services/api';
import * as usersApi from '../services/users.api';
import { MEMBERS_PAGE_SIZE, ROLE_LABELS, ROLE_OPTIONS } from '../utils/constants';
import { formatDate, pluralize } from '../utils/format';

/**
 * Render the members screen.
 *
 * `notice` is the single message area for the page — an invite confirmation, a role-change
 * confirmation, or a failed role change — so there is never more than one live region competing for a
 * screen reader's attention. A success is announced politely (`role="status"`), a failure assertively
 * (`role="alert"`).
 * @returns {JSX.Element}
 */
export function MembersPage() {
  const { user: me, organization } = useAuth();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [changingId, setChangingId] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const params = useMemo(() => ({ page, limit: MEMBERS_PAGE_SIZE }), [page]);
  const { status, data, error, reload } = useMembers(params);

  const onInvited = useCallback(
    ({ user }) => {
      const code = organization?.slug;
      setNotice({
        tone: 'success',
        message:
          `Invited ${user.name} as ${ROLE_LABELS[user.role]}. Give them the password you just set, ` +
          `through a channel you trust. They sign in with their email (${user.email}), that password` +
          `${code ? ` and the organization code “${code}”` : ' and your organization’s code'}. ` +
          'The password is not shown again.',
      });
      reload();
    },
    [organization, reload],
  );

  /**
   * Finish setting a member's password (SCRUM-36).
   *
   * The password is shown back to nobody and kept nowhere: the admin types it, sends it on through
   * a channel they trust, and the member is forced to replace it at their next sign-in, so what is
   * handed over is a way in rather than a lasting credential.
   */
  const onResetPassword = useCallback(
    async (member, password) => {
      setChangingId(member.id);
      setNotice(null);
      try {
        await usersApi.setPassword(member.id, password);
        setResetTarget(null);
        setNotice({
          tone: 'success',
          message:
            `Set a new password for ${member.name}. Give it to them through a channel you trust — ` +
            'they must choose their own as soon as they sign in, and any session they had is now ' +
            'signed out.',
        });
        reload();
        return null;
      } catch (err) {
        return err;
      } finally {
        setChangingId(null);
      }
    },
    [reload],
  );

  const onChangeRole = useCallback(
    async (member, role) => {
      setChangingId(member.id);
      setNotice(null);
      try {
        const result = await usersApi.changeRole(member.id, role);
        setNotice({
          tone: 'success',
          message: `${result.user.name} is now ${ROLE_LABELS[result.user.role]}.`,
        });
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setChangingId(null);
      }
    },
    [reload],
  );

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));

  return (
    <>
      <h1>Users</h1>
      <p className="hint">
        The people in your organization and what they can do. Every invitation and role change is
        recorded in the audit log.
      </p>

      <InviteForm onInvited={onInvited} />

      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert' : 'notice'}
        >
          <p>{notice.message}</p>
          <button type="button" className="secondary" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {status === 'loading' && !data ? <LoadingState label="Loading members…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the members" onRetry={reload} />
      ) : null}
      {status !== 'error' && data ? (
        <>
          <p className="hint">{pluralize(total, 'member')}</p>
          <DataTable
            caption="Members of your organization, oldest first."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (m) => (
                  <>
                    {m.name}
                    {m.id === me?.id ? <span className="meta"> (you)</span> : null}
                  </>
                ),
              },
              { key: 'email', header: 'Email', render: (m) => m.email },
              {
                key: 'role',
                header: 'Role',
                render: (m) =>
                  m.id === me?.id ? (
                    ROLE_LABELS[m.role]
                  ) : (
                    <select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={changingId === m.id}
                      onChange={(e) => onChangeRole(m, e.target.value)}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  ),
              },
              { key: 'joined', header: 'Joined', render: (m) => formatDate(m.createdAt) },
              {
                key: 'password',
                header: 'Password',
                render: (m) =>
                  m.id === me?.id ? (
                    // An admin resets their own password through the change-password screen; the
                    // API refuses this route aimed at yourself (SCRUM-36).
                    <span className="hint">—</span>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      disabled={changingId === m.id}
                      aria-expanded={resetTarget?.id === m.id}
                      onClick={() => setResetTarget(resetTarget?.id === m.id ? null : m)}
                    >
                      {m.mustChangePassword ? 'Set again' : 'Reset password'}
                    </button>
                  ),
              },
            ]}
            rows={data.items}
            getRowId={(m) => m.id}
            emptyMessage="There are no members yet."
          />
          {resetTarget ? (
            <ResetPasswordForm
              member={resetTarget}
              pending={changingId === resetTarget.id}
              onCancel={() => setResetTarget(null)}
              onSubmit={onResetPassword}
            />
          ) : null}
          {lastPage > 1 ? (
            <nav className="pagination" aria-label="Members pages">
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>
                Page {page} of {lastPage}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

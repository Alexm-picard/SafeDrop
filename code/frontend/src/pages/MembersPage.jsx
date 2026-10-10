// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen: list, invite form (admin-set initial password) with field-level API errors, per-row role change; SCRUM-241 redesign: a roster board with a column per role (drag a card or use its role control), invite and password reset in a side panel
// Human Contributions: reviewed and merged by Alex Picard (PR #15, 2026-09-19); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: InviteForm and ResetPasswordForm live in src/components. Follows the patterns in OrgSetupPage (form) and AuditLogPage (list, pagination). Verified by tests/unit/components/MembersPage.test.jsx. Reviewed before merge; see Human Contributions.

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
 * the list, but keeps showing the previous cards until the new ones arrive, so the control the admin
 * just used does not vanish from under their keyboard focus. A role change moves the card to its new
 * column; the page puts focus back on that card's role control when it lands.
 *
 * **SCRUM-241: a roster board.** One column per role, each saying what the role can do. A card's role
 * control is the way to change a role from the keyboard; dragging a card to another column does the
 * same thing for a mouse. Inviting someone and setting a password open in a side panel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Drawer } from '../components/Drawer';
import { ErrorState } from '../components/ErrorState';
import { InviteForm } from '../components/InviteForm';
import { LoadingState } from '../components/LoadingState';
import { ResetPasswordForm } from '../components/ResetPasswordForm';
import { useAuth } from '../hooks/useAuth';
import { useMembers } from '../hooks/useMembers';
import { errorMessage } from '../services/api';
import * as usersApi from '../services/users.api';
import { MEMBERS_PAGE_SIZE, ROLE_LABELS, ROLE_OPTIONS, ROLES } from '../utils/constants';
import { formatDate, pluralize } from '../utils/format';

/** The roster's columns, most authority first, each with what the role can do. */
const ROLE_COLUMNS = Object.freeze([
  Object.freeze({
    role: ROLES.ORG_ADMIN,
    title: 'Organization admins',
    blurb: 'Run the organization: people, groups, equipment and settings.',
  }),
  Object.freeze({
    role: ROLES.APPROVER,
    title: 'Approvers',
    blurb: 'Decide requests and record handoffs and returns.',
  }),
  Object.freeze({
    role: ROLES.MEMBER,
    title: 'Members',
    blurb: 'Browse the catalog and request equipment.',
  }),
]);

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
  const [inviting, setInviting] = useState(false);
  const [dropRole, setDropRole] = useState(null);
  const [refocusId, setRefocusId] = useState(null);
  const params = useMemo(() => ({ page, limit: MEMBERS_PAGE_SIZE }), [page]);
  const { status, data, error, reload } = useMembers(params);

  const onInvited = useCallback(
    ({ user }) => {
      const code = organization?.slug;
      setInviting(false);
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
      if (member.id === me?.id || member.role === role) {
        return;
      }
      setChangingId(member.id);
      setNotice(null);
      try {
        const result = await usersApi.changeRole(member.id, role);
        setNotice({
          tone: 'success',
          message: `${result.user.name} is now ${ROLE_LABELS[result.user.role]}.`,
        });
        setRefocusId(member.id);
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setChangingId(null);
      }
    },
    [me, reload],
  );

  // A role change moves the card to another column, which mounts a new role control; put focus back
  // on it once the refreshed list has landed, so a keyboard user carries on from where they were.
  useEffect(() => {
    if (!refocusId || status !== 'success') return;
    const control = document.getElementById(`role-${refocusId}`);
    if (control && document.activeElement !== control) control.focus();
  }, [data, refocusId, status]);

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));
  const items = data?.items ?? [];

  const onDrop = (role) => (event) => {
    event.preventDefault();
    setDropRole(null);
    const member = items.find((m) => m.id === event.dataTransfer.getData('text/plain'));
    if (member) onChangeRole(member, role);
  };

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p className="subtitle">
            The people in your organization and what they can do. Drag someone to another column, or
            use their role control, to change their role. Every invitation and role change is
            recorded in the audit log.
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setInviting(true)}>
            Invite someone
          </button>
        </div>
      </header>

      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert alert--inline' : 'notice notice--inline'}
        >
          <p>{notice.message}</p>
          <button type="button" className="secondary small" onClick={() => setNotice(null)}>
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
          {items.length === 0 ? (
            <p className="empty-state">There are no members yet.</p>
          ) : (
            <div className="roster">
              {ROLE_COLUMNS.map((column) => {
                const people = items.filter((m) => m.role === column.role);
                const headingId = `roster-${column.role}`;
                return (
                  <section
                    key={column.role}
                    className="roster-col"
                    aria-labelledby={headingId}
                    data-drop={dropRole === column.role ? 'true' : undefined}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropRole(column.role);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setDropRole(null);
                    }}
                    onDrop={onDrop(column.role)}
                  >
                    <header>
                      <div>
                        <h2 id={headingId}>{column.title}</h2>
                        <p className="roster-blurb">{column.blurb}</p>
                      </div>
                      <span className="board-count">{people.length}</span>
                    </header>
                    {people.length ? (
                      <ul className="board-list">
                        {people.map((m) => (
                          <PersonCard
                            key={m.id}
                            member={m}
                            isMe={m.id === me?.id}
                            busy={changingId === m.id}
                            resetOpen={resetTarget?.id === m.id}
                            onRole={onChangeRole}
                            onReset={() => setResetTarget(resetTarget?.id === m.id ? null : m)}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="board-none">No one has this role on this page.</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
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

      {inviting ? (
        <Drawer
          title="Invite a member"
          description="They sign in with the password you set here."
          onClose={() => setInviting(false)}
        >
          <InviteForm onInvited={onInvited} inPanel />
        </Drawer>
      ) : null}
      {resetTarget ? (
        <Drawer
          title={`Set a password for ${resetTarget.name}`}
          onClose={() => setResetTarget(null)}
        >
          <ResetPasswordForm
            member={resetTarget}
            pending={changingId === resetTarget.id}
            onCancel={() => setResetTarget(null)}
            onSubmit={onResetPassword}
            inPanel
          />
        </Drawer>
      ) : null}
    </>
  );
}

/**
 * One person on the roster: who they are, when they joined, their role control and their password
 * action. The viewer's own card has neither control (see the page's notes) and cannot be dragged.
 * @param {{ member: object, isMe: boolean, busy: boolean, resetOpen: boolean,
 *   onRole: (member: object, role: string) => void, onReset: () => void }} props
 * @returns {JSX.Element}
 */
function PersonCard({ member: m, isMe, busy, resetOpen, onRole, onReset }) {
  return (
    <li
      className="person-card"
      draggable={!isMe && !busy}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', m.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="person-head">
        <Avatar name={m.name} role={m.role} />
        <div className="person-text">
          <strong>
            {m.name}
            {isMe ? <span className="meta"> (you)</span> : null}
          </strong>
          <span>{m.email}</span>
        </div>
      </div>
      <p className="person-meta">
        Joined {formatDate(m.createdAt)}
        {m.mustChangePassword ? (
          <span className="badge" data-tone="warn">
            Temporary password
          </span>
        ) : null}
      </p>
      <div className="person-controls">
        {isMe ? (
          <span className="person-role">{ROLE_LABELS[m.role]}</span>
        ) : (
          <select
            id={`role-${m.id}`}
            aria-label={`Role for ${m.name}`}
            value={m.role}
            disabled={busy}
            onChange={(e) => onRole(m, e.target.value)}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        )}
        {isMe ? null : (
          // An admin resets their own password through the change-password screen; the API refuses
          // this route aimed at yourself (SCRUM-36).
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            aria-expanded={resetOpen}
            onClick={onReset}
          >
            {m.mustChangePassword ? 'Set again' : 'Reset password'}
          </button>
        )}
      </div>
    </li>
  );
}

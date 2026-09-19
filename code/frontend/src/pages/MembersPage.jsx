// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen: list with invitation status, invite form with field-level API errors, delivery-aware notices, resend invitation, per-row role change
// Human Contributions: pending team review
// Notes: Follows the patterns in OrgSetupPage (form) and AuditLogPage (list, pagination). Verified by tests/unit/components/MembersPage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * The members screen (ORG_ADMIN only): see who is in the organisation, invite people, change roles.
 *
 * This is what makes the rest of the product demonstrable — until an organisation can have more than
 * its founding admin there is nobody to submit a request or approve one.
 *
 * Three decisions worth knowing:
 *
 * **The admin never sees, or chooses, anyone's password.** Inviting emails the member a one-time link
 * (valid for 72 hours) to choose their own. There is no password field here and none in the API's
 * response — not even the link, which would let the admin open it and choose for them. What the page can
 * report is how the email went (`delivery`): sent, not sent because no mail server is configured, or
 * failed, in which case the row offers "Resend invitation".
 *
 * **Resend is offered for anyone who has not yet accepted**, expired or not: it replaces the link, so
 * the old one stops working, and restarts the 72 hours.
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
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { useMembers } from '../hooks/useMembers';
import { errorMessage, isApiError } from '../services/api';
import * as usersApi from '../services/users.api';
import { MEMBERS_PAGE_SIZE, ROLE_LABELS, ROLES } from '../utils/constants';
import { formatDate, pluralize } from '../utils/format';

/** The roles an admin can invite as or change to, least privileged first. */
const ROLE_OPTIONS = Object.freeze(Object.values(ROLES));

const EMPTY_FORM = Object.freeze({
  name: '',
  email: '',
  role: ROLES.MEMBER,
});

/**
 * Work out which form field, if any, an API error belongs to.
 *
 * A 400 lists its problems per field (`fieldErrors()`), but a 409 for a duplicate email carries a single
 * `{ field }` instead, so it is folded into the same shape here and shows beside the email input rather
 * than as a banner.
 * @param {import('../services/api').ApiError} err
 * @returns {Record<string, string>}
 */
function fieldErrorsOf(err) {
  const perField = err.fieldErrors();
  const single = err.details && !Array.isArray(err.details) ? err.details.field : null;
  if (typeof single === 'string' && !(single in perField)) {
    perField[single] = err.message;
  }
  return perField;
}

/**
 * Turn an invitation result into the message the admin sees.
 *
 * The three `delivery` outcomes deserve different wording because they call for different action:
 * `email` needs nothing, `log` means this server has no mail configured (a setup matter, not a failure of
 * the invitation), and `failed` means the member exists but was never told, so it is shown as an error
 * with the way out — resend — spelled out.
 * @param {{ name: string, email: string, role: string, invitation: { expiresAt: string }|null }} user
 * @param {'email'|'log'|'failed'} delivery
 * @param {boolean} [resent] whether this was a resend rather than a first invitation
 * @returns {{ tone: 'success'|'error', message: string }}
 */
function deliveryNotice(user, delivery, resent = false) {
  if (delivery === 'failed') {
    return {
      tone: 'error',
      message: `${user.name} ${resent ? 'has a new invitation' : `was invited as ${ROLE_LABELS[user.role]}`}, but the email could not be sent. Use “Resend invitation” to try again.`,
    };
  }
  const until = user.invitation
    ? ` The link works once and expires ${formatDate(user.invitation.expiresAt)}.`
    : '';
  if (delivery === 'log') {
    return {
      tone: 'success',
      message: `${user.name} (${user.email}) was ${resent ? 'sent a new invitation' : `invited as ${ROLE_LABELS[user.role]}`}, but no email was sent because this server has no mail configured. The link was written to the server log instead.${until}`,
    };
  }
  return {
    tone: 'success',
    message: `${resent ? 'A new invitation was emailed to' : `Invited ${user.name} as ${ROLE_LABELS[user.role]}. An invitation was emailed to`} ${user.email}.${until} They choose their own password; you will never see it.`,
  };
}

/**
 * The invite form.
 *
 * Reports success upward rather than rendering it, because the confirmation — and above all the
 * and whether the email went out — belongs in the page-level notice, which must outlive the form's own
 * state.
 * @param {{ onInvited: (result: { user: object, delivery: string }) => void }} props
 * @returns {JSX.Element}
 */
function InviteForm({ onInvited }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await usersApi.invite({
        name: values.name,
        email: values.email,
        role: values.role,
      });
      setValues(EMPTY_FORM);
      onInvited(result);
    } catch (err) {
      if (isApiError(err)) {
        const perField = fieldErrorsOf(err);
        setFieldErrors(perField);
        if (Object.keys(perField).length === 0) {
          setError(errorMessage(err));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  const describedBy = (name) => (fieldErrors[name] ? `${name}-error` : undefined);

  return (
    <form
      className="card invite-form"
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="invite-title"
    >
      <h2 id="invite-title">Invite a member</h2>
      {error ? (
        <div role="alert" className="alert">
          {error}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="invite-name">Name</label>
        <input
          id="invite-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          value={values.name}
          onChange={set('name')}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={describedBy('name')}
        />
        {fieldErrors.name ? (
          <span id="name-error" className="field-error">
            {fieldErrors.name}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          value={values.email}
          onChange={set('email')}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy('email')}
        />
        {fieldErrors.email ? (
          <span id="email-error" className="field-error">
            {fieldErrors.email}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="invite-role">Role</label>
        <select id="invite-role" name="role" value={values.role} onChange={set('role')}>
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        {fieldErrors.role ? (
          <span id="role-error" className="field-error">
            {fieldErrors.role}
          </span>
        ) : null}
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Inviting…' : 'Invite member'}
      </button>
    </form>
  );
}

/**
 * Render the members screen.
 *
 * `notice` is the single message area for the page — an invite or resend confirmation, a role-change
 * confirmation, or a failed role change — so there is never more than one live region competing for a
 * screen reader's attention. A success is announced politely (`role="status"`), a failure assertively
 * (`role="alert"`).
 * @returns {JSX.Element}
 */
export function MembersPage() {
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [changingId, setChangingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const params = useMemo(() => ({ page, limit: MEMBERS_PAGE_SIZE }), [page]);
  const { status, data, error, reload } = useMembers(params);

  const onInvited = useCallback(
    ({ user, delivery }) => {
      setNotice(deliveryNotice(user, delivery));
      reload();
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

  const onResend = useCallback(
    async (member) => {
      setResendingId(member.id);
      setNotice(null);
      try {
        const result = await usersApi.resendInvite(member.id);
        setNotice(deliveryNotice(result.user, result.delivery, true));
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setResendingId(null);
      }
    },
    [reload],
  );

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));

  return (
    <>
      <h1>Members</h1>
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
              {
                key: 'status',
                header: 'Status',
                render: (m) => {
                  if (!m.invitation) {
                    return 'Active';
                  }
                  return m.invitation.status === 'EXPIRED'
                    ? 'Invitation expired'
                    : `Invited · link expires ${formatDate(m.invitation.expiresAt)}`;
                },
              },
              { key: 'joined', header: 'Added', render: (m) => formatDate(m.createdAt) },
              {
                key: 'actions',
                header: 'Invitation',
                render: (m) =>
                  m.invitation ? (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Resend invitation to ${m.name}`}
                      disabled={resendingId === m.id}
                      onClick={() => onResend(m)}
                    >
                      {resendingId === m.id ? 'Sending…' : 'Resend invitation'}
                    </button>
                  ) : null,
              },
            ]}
            rows={data.items}
            getRowId={(m) => m.id}
            emptyMessage="There are no members yet."
          />
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

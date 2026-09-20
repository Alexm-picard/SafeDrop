// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: Members screen: list, invite form (admin-set initial password) with field-level API errors, per-row role change
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
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { useMembers } from '../hooks/useMembers';
import { errorMessage, isApiError } from '../services/api';
import * as usersApi from '../services/users.api';
import { MEMBERS_PAGE_SIZE, ROLE_LABELS, ROLES } from '../utils/constants';
import { formatDate, pluralize } from '../utils/format';
import { fieldErrorsOf } from '../utils/formErrors';

/** The roles an admin can invite as or change to, least privileged first. */
const ROLE_OPTIONS = Object.freeze(Object.values(ROLES));

const EMPTY_FORM = Object.freeze({
  name: '',
  email: '',
  role: ROLES.MEMBER,
  password: '',
});

/**
 * The invite form.
 *
 * Reports success upward rather than rendering it, because the confirmation belongs in the page-level
 * notice, which must outlive the form's own state.
 * @param {{ onInvited: (result: { user: object }) => void }} props
 * @returns {JSX.Element}
 */
function InviteForm({ onInvited }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        password: values.password,
      });
      // Cleared at once: the password lives in this form only as long as it takes to send.
      setValues(EMPTY_FORM);
      setShowPassword(false);
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
      <div className="field">
        <label htmlFor="invite-password">Initial password</label>
        <input
          id="invite-password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={values.password}
          onChange={set('password')}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={[fieldErrors.password ? 'password-error' : null, 'password-hint']
            .filter(Boolean)
            .join(' ')}
        />
        <span id="password-hint" className="hint">
          At least 10 characters. Share it with them securely; they sign in with it.
        </span>
        {fieldErrors.password ? (
          <span id="password-error" className="field-error">
            {fieldErrors.password}
          </span>
        ) : null}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />{' '}
          Show password
        </label>
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
 * `notice` is the single message area for the page — an invite confirmation, a role-change
 * confirmation, or a failed role change — so there is never more than one live region competing for a
 * screen reader's attention. A success is announced politely (`role="status"`), a failure assertively
 * (`role="alert"`).
 * @returns {JSX.Element}
 */
/**
 * Set one member's password, as an admin (SCRUM-36).
 *
 * Separate from the row so the password has a real field — labelled, with the same show-password
 * option as the invite form, because a typo in a credential nobody can read back is unrecoverable.
 * The value lives here only until it is sent.
 * @param {{ member: object, pending: boolean, onCancel: () => void, onSubmit: (member: object, password: string) => Promise<unknown> }} props
 * @returns {JSX.Element}
 */
function ResetPasswordForm({ member, pending, onCancel, onSubmit }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [fieldError, setFieldError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setFieldError(null);
    const err = await onSubmit(member, password);
    if (err) {
      const perField = isApiError(err) ? fieldErrorsOf(err) : {};
      setFieldError(perField.password ?? errorMessage(err));
      return;
    }
    setPassword('');
    setShow(false);
  };

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby="reset-title">
      <h2 id="reset-title">Set a password for {member.name}</h2>
      <p className="hint">
        Use this when someone cannot use the emailed link. They must choose their own password the
        next time they sign in, and every session they have now ends.
      </p>
      <div className="field">
        <label htmlFor="reset-password">Temporary password</label>
        <input
          id="reset-password"
          name="password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={fieldError ? 'true' : undefined}
          aria-describedby={fieldError ? 'reset-password-error' : undefined}
        />
        <label className="checkbox">
          <input type="checkbox" checked={show} onChange={() => setShow((v) => !v)} />
          Show password
        </label>
        {fieldError ? (
          <span id="reset-password-error" className="field-error">
            {fieldError}
          </span>
        ) : null}
      </div>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Setting…' : 'Set password'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

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

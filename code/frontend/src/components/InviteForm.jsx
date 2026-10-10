// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket; moved out of MembersPage.jsx unchanged)
// AI-Assisted Areas: invite form (admin-set initial password) with field-level API errors; SCRUM-241: inPanel rendering for the side panel
// Human Contributions: reviewed and approved by Mateus Silva (PR #58, 2026-10-03); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Moved verbatim from MembersPage.jsx to follow the SPPP coding standard (components live in
// src/components). Verified by tests/unit/components/MembersPage.test.jsx. Reviewed before merge; see Human Contributions.

import { useState } from 'react';
import { errorMessage, isApiError } from '../services/api';
import * as usersApi from '../services/users.api';
import { ROLE_LABELS, ROLE_OPTIONS, ROLES } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';

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
 * SCRUM-241: `inPanel` renders it for the Users page's side panel, which supplies the frame and the
 * heading, so the form drops its own card and title and is labelled by name instead.
 * @param {{ onInvited: (result: { user: object }) => void, inPanel?: boolean }} props
 * @returns {JSX.Element}
 */
export function InviteForm({ onInvited, inPanel = false }) {
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
      className={inPanel ? 'invite-form' : 'card invite-form'}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={inPanel ? undefined : 'invite-title'}
      aria-label={inPanel ? 'Invite a member' : undefined}
    >
      {inPanel ? null : <h2 id="invite-title">Invite a member</h2>}
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

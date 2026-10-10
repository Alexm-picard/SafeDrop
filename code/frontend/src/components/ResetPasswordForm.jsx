// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-36; moved out of MembersPage.jsx unchanged)
// AI-Assisted Areas: admin set-password form with show-password option and field-level API error; SCRUM-241: inPanel rendering for the side panel
// Human Contributions: reviewed and approved by Mateus Silva (PR #58, 2026-10-03); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Moved verbatim from MembersPage.jsx to follow the SPPP coding standard (components live in
// src/components). Verified by tests/unit/components/MembersPage.test.jsx. Reviewed before merge; see Human Contributions.

import { useState } from 'react';
import { errorMessage, isApiError } from '../services/api';
import { fieldErrorsOf } from '../utils/formErrors';

/**
 * Set one member's password, as an admin (SCRUM-36).
 *
 * Separate from the row so the password has a real field — labelled, with the same show-password
 * option as the invite form, because a typo in a credential nobody can read back is unrecoverable.
 * The value lives here only until it is sent.
 * SCRUM-241: `inPanel` drops the card and the heading, which the side panel supplies.
 * @param {{ member: object, pending: boolean, onCancel: () => void, onSubmit: (member: object, password: string) => Promise<unknown>, inPanel?: boolean }} props
 * @returns {JSX.Element}
 */
export function ResetPasswordForm({ member, pending, onCancel, onSubmit, inPanel = false }) {
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
    <form
      className={inPanel ? undefined : 'card'}
      onSubmit={submit}
      noValidate
      aria-labelledby={inPanel ? undefined : 'reset-title'}
      aria-label={inPanel ? `Set a password for ${member.name}` : undefined}
    >
      {inPanel ? null : <h2 id="reset-title">Set a password for {member.name}</h2>}
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

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: change-password screen, including the forced variant after an admin-set password
// Human Contributions: pending team review
// Notes: Written for SCRUM-22. Must be reviewed and tested by the owning team member before merge.

/**
 * Changing your own password.
 *
 * Two ways in, one screen. Someone can come here deliberately, or be sent here because their
 * password was chosen by an admin — at invitation, or through a reset — in which case the API
 * refuses everything else until they pick their own. The copy changes for that case; the form does
 * not, and neither does what it sends.
 *
 * The API is the thing enforcing this. The guard in RequireAuth only spares the person a screenful
 * of 403s.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage, isApiError } from '../services/api';
import { changePassword } from '../services/auth.api';
import { landingFor } from '../utils/constants';

/**
 * Render the change-password form.
 *
 * On success the session is refreshed so the rest of the app learns the flag has cleared, then the
 * person lands where their role normally starts (SCRUM-21).
 * @returns {JSX.Element}
 */
export function ChangePasswordPage() {
  const { user, role, refresh } = useAuth();
  const navigate = useNavigate();
  const forced = Boolean(user?.mustChangePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    if (newPassword !== confirmation) {
      setFieldErrors({ newPassword: 'Both passwords must match.' });
      return;
    }
    setPending(true);
    try {
      await changePassword({ currentPassword, newPassword });
      await refresh();
      navigate(landingFor(role), { replace: true });
    } catch (err) {
      const perField = isApiError(err) ? err.fieldErrors() : {};
      if (Object.keys(perField).length > 0) {
        setFieldErrors(perField);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main id="main" className="auth-page">
      <h1>{forced ? 'Choose your own password' : 'Change your password'}</h1>
      {forced ? (
        <p role="status" className="hint">
          You are signed in with a password someone else set for you. Choose your own to continue —
          until you do, the rest of SafeDrop stays locked.
        </p>
      ) : null}
      <form className="card" onSubmit={onSubmit} noValidate>
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="currentPassword">
            {forced ? 'The password you were given' : 'Current password'}
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            aria-invalid={fieldErrors.currentPassword ? 'true' : undefined}
          />
          {fieldErrors.currentPassword ? (
            <span className="field-error">{fieldErrors.currentPassword}</span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={fieldErrors.newPassword ? 'true' : undefined}
          />
          {fieldErrors.newPassword ? (
            <span className="field-error">{fieldErrors.newPassword}</span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="confirmation">Confirm new password</label>
          <input
            id="confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </main>
  );
}

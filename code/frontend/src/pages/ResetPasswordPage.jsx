// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: reset-password form driven by the ?token= query parameter, field-level API errors, redirect to sign in
// Human Contributions: pending team review
// Notes: Written for SCRUM-22 (subtask SCRUM-31). Must be reviewed and tested by the owning team member before merge.

/**
 * Choosing a new password from a mailed link.
 *
 * The token arrives in the query string, never in a field: the person came here by clicking, and
 * asking them to paste a 43-character string would be theatre. It is read once on render and sent
 * back with the new password.
 *
 * A link that has expired or been used already fails at the API, not here — the page cannot know,
 * and guessing would mean either a false reassurance or a false alarm. The confirmation field is
 * checked locally, because that mismatch needs no round trip and no API call should be spent on it.
 *
 * On success the user is sent to sign in rather than being signed in automatically: proving the new
 * password works is the point, and the API deliberately issues no session here.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage, isApiError } from '../services/api';
import { resetPassword } from '../services/auth.api';
import { ROUTES } from '../utils/constants';

/**
 * Render the new-password form and spend the token.
 *
 * A missing token is its own state: arriving here without one means a mangled link, and a form that
 * cannot possibly succeed should not be offered.
 * @returns {JSX.Element}
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (newPassword !== confirmation) {
      setFieldError('Both passwords must match.');
      return;
    }
    setPending(true);
    try {
      await resetPassword({ token, newPassword });
      navigate(ROUTES.login, { replace: true, state: { passwordReset: true } });
    } catch (err) {
      // A rejected password comes back per field; an unusable link comes back against `token`,
      // which has no input here, so it belongs in the banner.
      const perField = isApiError(err) ? err.fieldErrors() : {};
      if (perField.newPassword) {
        setFieldError(perField.newPassword);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <main id="main" className="auth-page">
        <h1>Reset your password</h1>
        <div className="card">
          <div role="alert" className="alert">
            This link is incomplete. Open the most recent link from your email, or ask for a new
            one.
          </div>
          <p>
            <Link to={ROUTES.forgotPassword}>Ask for a new link</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="auth-page">
      <h1>Choose a new password</h1>
      <form className="card" onSubmit={onSubmit} noValidate>
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : null}
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
            aria-describedby={fieldError ? 'newPassword-error' : undefined}
            aria-invalid={fieldError ? 'true' : undefined}
          />
          {fieldError ? (
            <span id="newPassword-error" className="field-error">
              {fieldError}
            </span>
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
      <p>
        <Link to={ROUTES.forgotPassword}>Ask for a new link</Link>
      </p>
    </main>
  );
}

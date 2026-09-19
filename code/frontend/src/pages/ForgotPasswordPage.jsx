// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: forgot-password form, identical confirmation whatever the outcome, admin fallback copy
// Human Contributions: pending team review
// Notes: Written for SCRUM-22 (subtask SCRUM-30). Must be reviewed and tested by the owning team member before merge.

/**
 * Asking for a password-reset link.
 *
 * Takes the organisation code as well as the address, because email is unique *per organisation*
 * (OD-3) — the same address can belong to accounts in two organisations, so it alone does not say
 * which account to reset.
 *
 * The screen shows the same confirmation whatever happened: sent, address unknown, organisation
 * unknown. The API is deliberately unable to tell them apart (SR-2), and a UI that said "no such
 * account" would undo that in one line of JSX.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { forgotPassword } from '../services/auth.api';
import { errorMessage } from '../services/api';
import { ROUTES } from '../utils/constants';

/**
 * Render the request form, or the confirmation once it has been submitted.
 *
 * Only a transport-level failure shows an error; anything the API answers is a success as far as
 * this screen is concerned. `pending` disables the button so an impatient second click cannot spend
 * two of the five requests the rate limiter allows.
 * @returns {JSX.Element}
 */
export function ForgotPasswordPage() {
  const [orgSlug, setOrgSlug] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await forgotPassword({ orgSlug: orgSlug.trim().toLowerCase(), email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <main id="main" className="auth-page">
        <h1>Check your email</h1>
        <div className="card">
          <p role="status">
            If that account exists, a reset link is on its way. The link works for 10 minutes and
            can only be used once.
          </p>
          <p className="hint">
            Nothing arrived? Check the spam folder, confirm the organization code and address, then
            ask your organization admin — they can set a new password for you.
          </p>
          <p>
            <Link to={ROUTES.login}>Back to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="auth-page">
      <h1>Reset your password</h1>
      <form className="card" onSubmit={onSubmit} noValidate>
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="orgSlug">Organization</label>
          <input
            id="orgSlug"
            name="orgSlug"
            autoComplete="organization"
            required
            value={orgSlug}
            onChange={(e) => setOrgSlug(e.target.value)}
            aria-describedby="orgSlug-hint"
          />
          <span id="orgSlug-hint" className="hint">
            The short name of your organization, e.g. <code>acme-robotics</code>.
          </span>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Email me a reset link'}
        </button>
      </form>
      <p className="hint">
        Cannot remember which address you used? Ask your organization admin — they can set a new
        password for you directly.
      </p>
      <p>
        <Link to={ROUTES.login}>Back to sign in</Link>
      </p>
    </main>
  );
}

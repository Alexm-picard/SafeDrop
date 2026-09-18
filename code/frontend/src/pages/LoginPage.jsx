// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: working login form (org slug + email + password), API error display, redirect after success (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The sign-in screen.
 *
 * Collects the three things a SafeDrop login needs — organisation slug, email and password — because
 * email is unique per organisation (OD-3), so the slug is what selects the tenant to authenticate
 * against.
 *
 * The form is deliberately plain HTML with `noValidate`: the browser's own validation bubbles are
 * inconsistent and hard to make accessible, so the API's answer is the single source of truth about
 * what was wrong.
 */
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../services/api';
import { APP_NAME, ROUTES } from '../utils/constants';
/**
 * Render the login form and sign the user in.
 *
 * An already-authenticated visitor is redirected instead of shown the form, to wherever they were
 * headed before `RequireAuth` intercepted them (`location.state.from`), falling back to the home
 * page.
 *
 * On submit, the slug is lowercased and the email trimmed — the API normalises both, and doing it
 * here means a stray capital or trailing space never reads as a failed login. The password is sent
 * exactly as typed, since trimming it would silently change a legitimate credential.
 *
 * Failures show the API's message verbatim; it is deliberately the same for a wrong organisation, an
 * unknown email and a wrong password, so the screen cannot reveal which accounts exist. `pending`
 * disables the button to stop double submission, and is cleared in `finally` so the form stays usable
 * after a failure.
 * @returns {JSX.Element}
 */
export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [orgSlug, setOrgSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const from = location.state?.from ?? ROUTES.home;
  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }
  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login({ orgSlug: orgSlug.trim().toLowerCase(), email: email.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <main id="main" className="auth-page">
      <h1>Sign in to {APP_NAME}</h1>
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
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        New here? <Link to={ROUTES.setup}>Create an organization</Link>
      </p>
    </main>
  );
}

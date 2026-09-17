// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: working login form (org slug + email + password), API error display, redirect after success (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../services/api';
import { APP_NAME, ROUTES } from '../utils/constants';
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

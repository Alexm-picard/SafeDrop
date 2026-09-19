// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: working organization bootstrap form with field-level API errors (SCRUM-101)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The sign-up screen: create an organisation and become its first administrator.
 *
 * The one route that creates a privileged account without a privileged caller, matching the public
 * `POST /api/organizations` endpoint. Because that call also returns a session, the new admin lands on
 * their dashboard without a separate login.
 *
 * The fields are declared as data rather than written out four times, which keeps each one's label,
 * hint and error wiring identical.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage, isApiError } from '../services/api';
import * as organizationsApi from '../services/organizations.api';
import { ROUTES } from '../utils/constants';
/**
 * The form's fields, as data: name, label, input type, autocomplete hint, and optional help text.
 *
 * Driving the markup from this list means the accessibility wiring — label association,
 * `aria-describedby`, `aria-invalid` — is written once and applies to every field.
 */
const FIELDS = [
  { name: 'orgName', label: 'Organization name', type: 'text', autoComplete: 'organization' },
  { name: 'adminName', label: 'Your name', type: 'text', autoComplete: 'name' },
  { name: 'adminEmail', label: 'Your email', type: 'email', autoComplete: 'email' },
  {
    name: 'adminPassword',
    label: 'Password',
    type: 'password',
    autoComplete: 'new-password',
    hint: 'At least 10 characters.',
  },
];
/**
 * Render the sign-up form, create the organisation, and adopt the returned session.
 *
 * On success `setSession()` takes the user and organisation straight from the response, so the app
 * does not need a second `/me` round trip before navigating.
 *
 * Error handling separates the two cases a user can act on differently. A 400 with field details is
 * spread across the individual inputs via `fieldErrors()`, so each problem appears next to the field
 * it belongs to. Anything else — a 409 on a duplicate name, a network failure — becomes one message
 * at the top of the form, since it is not about a single field. A 400 that arrives with no field
 * details also falls back to the banner rather than vanishing.
 * @returns {JSX.Element}
 */
export function OrgSetupPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    orgName: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const { organization, user } = await organizationsApi.createOrganization(values);
      setSession(user, organization);
      navigate(ROUTES.admin, { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        const perField = err.fieldErrors();
        setFieldErrors(perField);
        if (Object.keys(perField).length === 0 || err.status !== 400) {
          setError(errorMessage(err));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <main id="main" className="auth-page">
      <h1>Create an organization</h1>
      <p className="hint">You will become its first administrator.</p>
      <form className="card" onSubmit={onSubmit} noValidate>
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : null}
        {FIELDS.map((field) => {
          const message = fieldErrors[field.name];
          const describedBy = [
            message ? `${field.name}-error` : null,
            field.hint ? `${field.name}-hint` : null,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div className="field" key={field.name}>
              <label htmlFor={field.name}>{field.label}</label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                autoComplete={field.autoComplete}
                required
                value={values[field.name]}
                aria-invalid={message ? true : undefined}
                aria-describedby={describedBy || undefined}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              />
              {field.hint ? (
                <span id={`${field.name}-hint`} className="hint">
                  {field.hint}
                </span>
              ) : null}
              {message ? (
                <span id={`${field.name}-error`} className="field-error">
                  {message}
                </span>
              ) : null}
            </div>
          );
        })}
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create organization'}
        </button>
      </form>
      <p>
        Already have an account? <Link to={ROUTES.login}>Sign in</Link>
      </p>
    </main>
  );
}

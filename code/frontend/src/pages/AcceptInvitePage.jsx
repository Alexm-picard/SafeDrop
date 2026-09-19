// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the emailed-invitation request)
// AI-Assisted Areas: public accept-invitation screen: choose a password from an emailed one-time link; distinct expired / invalid / success states; shows the organization code for next sign-in
// Human Contributions: pending team review
// Notes: Follows the form pattern in OrgSetupPage. Verified by tests/unit/components/AcceptInvitePage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * Where an invited member lands from their email: choose a password and be signed in.
 *
 * The one-time token in the link (`/accept-invite?token=…`) is the credential, so this page is public.
 * The decisions worth knowing:
 *
 * **The token is taken out of the address bar.** It is read once into state and the URL is replaced with
 * a bare `/accept-invite`, so it does not sit in the browser's history, an autofill of the address, or
 * a screenshot of the page. It is still in the email, which is the intended place for it.
 *
 * **A dead link is not a form.** An expired link and an unknown or already-used one both make the form
 * pointless, and they call for different action — ask your admin to resend, versus "you may already have
 * an account" — so each gets its own explanation and the form is replaced rather than left to fail again.
 *
 * **The confirmation is checked here, before the request**, since a mismatch is a typo and there is no
 * point spending a one-time token on it. Everything else — strength, and the rest — comes back from the
 * API as field errors, so there is one definition of each rule.
 *
 * **Success shows the organization code.** Signing in later needs it, and a new member has no reason to
 * know it; the email says it too, but it is the moment they are looking at the screen. They are already
 * signed in (the API set the session), so continuing goes straight into the app.
 *
 * The password is held in component state only, goes to the API once, and is stored there only as a hash.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { errorMessage, isApiError } from '../services/api';
import * as authApi from '../services/auth.api';
import { APP_NAME, ROUTES } from '../utils/constants';

const EMPTY = Object.freeze({ password: '', confirmPassword: '' });

/**
 * Explanations for a link that cannot be used, keyed by the API's error code.
 */
const DEAD_LINKS = Object.freeze({
  INVITATION_EXPIRED: {
    title: 'This invitation has expired',
    body: 'Invitation links stop working after 72 hours. Ask your administrator to send you a new one.',
  },
  INVITATION_INVALID: {
    title: 'This invitation link is not valid',
    body: 'It may have already been used, or been replaced by a newer invitation. If you have already set a password, sign in instead; otherwise ask your administrator to send a new invitation.',
  },
});

/**
 * Render the accept-invitation screen.
 * @returns {JSX.Element}
 */
export function AcceptInvitePage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once: the effect below removes it from the URL, and a re-render must not lose it.
  const [token] = useState(() => searchParams.get('token'));
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [deadLink, setDeadLink] = useState(token ? null : 'INVITATION_INVALID');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (searchParams.has('token')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (values.password !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: 'The two passwords do not match.' });
      return;
    }
    setPending(true);
    setFieldErrors({});
    try {
      const { user, organization } = await authApi.acceptInvite({
        token,
        password: values.password,
      });
      setValues(EMPTY);
      setSession(user, organization);
      setDone({ user, organization });
    } catch (err) {
      if (isApiError(err) && DEAD_LINKS[err.code]) {
        setDeadLink(err.code);
      } else if (isApiError(err)) {
        const perField = err.fieldErrors();
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

  if (done) {
    return (
      <main id="main" className="auth-page">
        <h1>You’re all set</h1>
        <div role="status" className="notice">
          <p>
            Welcome to {done.organization?.name ?? APP_NAME}, {done.user.name}. Your password is
            saved and you are signed in.
          </p>
          {done.organization ? (
            <p>
              Next time, sign in with your email and the organization code{' '}
              <code>{done.organization.slug}</code>.
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => navigate(ROUTES.home, { replace: true })}>
          Continue to {APP_NAME}
        </button>
      </main>
    );
  }

  if (deadLink) {
    const { title, body } = DEAD_LINKS[deadLink];
    return (
      <main id="main" className="auth-page">
        <h1>{title}</h1>
        <div role="alert" className="alert">
          {body}
        </div>
        <p>
          <Link to={ROUTES.login}>Go to sign in</Link>
        </p>
      </main>
    );
  }

  const fields = [
    {
      name: 'password',
      label: 'Choose a password',
      autoComplete: 'new-password',
      hint: 'At least 10 characters.',
    },
    { name: 'confirmPassword', label: 'Confirm password', autoComplete: 'new-password' },
  ];

  return (
    <main id="main" className="auth-page">
      <h1>Choose your password</h1>
      <p>
        You’ve been invited to {APP_NAME}. Choose a password to activate your account. It is stored
        encrypted, and nobody — including whoever invited you — can see it.
      </p>
      <form className="card" onSubmit={onSubmit} noValidate>
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : null}
        {fields.map((field) => {
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
                type="password"
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
          {pending ? 'Saving…' : 'Set password and continue'}
        </button>
      </form>
    </main>
  );
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: public landing page at `/`: hero, how-it-works, feature summary, sign-in/sign-up calls to action
// Human Contributions:
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The public landing page: what a visitor sees at `/` before they have a session.
 *
 * It is the only page outside `RequireAuth` that is not a form, and it owns its own header and footer
 * rather than reusing `Layout` — the shell's navigation is for people who are signed in, and showing
 * it here would offer links that all bounce to the login page.
 *
 * The copy describes only what SafeDrop actually does today. A landing page that promises a feature
 * the product does not have costs more in the first five minutes of use than it wins in the first
 * five seconds of reading.
 *
 * A signed-in visitor is not redirected away: they get the same page with the calls to action swapped
 * for a way back into the application. While the session is still resolving, the page shows the
 * signed-out actions, which is what nearly every visitor to this URL needs.
 */
import { Link } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { APP_NAME, landingFor, ROUTES } from '../utils/constants';

/**
 * The borrowing flow, in the order it happens. Written as data so each step's markup is identical.
 */
const STEPS = [
  {
    title: 'Browse the catalog',
    body: 'Everything your organization owns, down to the individual unit, with what is on the shelf right now and what is already out.',
  },
  {
    title: 'Request what you need',
    body: 'A member asks for an item over the dates they need it. Nothing leaves on a verbal promise and a sticky note.',
  },
  {
    title: 'An approver decides',
    body: 'Approvers work a queue, approve or deny with a note, and hand the item over when the borrower turns up.',
  },
  {
    title: 'Get it back',
    body: 'Returns record the condition it came back in, and anything past its due date is counted as overdue until it does.',
  },
];

/**
 * What the product is for, four claims deep. Each one is something the application does today.
 */
const FEATURES = [
  {
    title: 'Roles that match how teams work',
    body: 'Members request, approvers decide, administrators run the organization. Every permission is enforced by the API, not merely hidden in the interface.',
  },
  {
    title: 'Overdue items, at a glance',
    body: 'The admin dashboard counts what you own, what is checked out, what is waiting on a decision and what is late — over 30 days of checkout activity.',
  },
  {
    title: 'A history nobody can quietly edit',
    body: 'Approvals, handoffs, returns and role changes are all written to an audit log that records who did it and when, and that the application cannot rewrite.',
  },
  {
    title: 'Your organization, and only yours',
    body: 'Catalog, people and history are scoped to your organization. Another organization on the same deployment cannot see any of it.',
  },
];

/**
 * Render the landing page.
 *
 * The heading order is deliberate and unbroken — one `h1` in the hero, an `h2` per section, an `h3`
 * per card — because it is how a screen-reader user skims a long page (NFR-12). The steps are an
 * ordered list, since their order is the point.
 * @returns {JSX.Element}
 */
export function LandingPage() {
  const { status, role } = useAuth();
  const signedIn = status === 'authenticated';
  const appHref = landingFor(role);
  /**
   * The calls to action, which are the whole job of this page: a way in for a visitor, a way back for
   * someone who already has a session.
   * @param {{ primaryLabel?: string }} [options] the wording of the main button, which differs in the
   *   header (short) from the hero and closing band (explicit)
   */
  const actions = ({ primaryLabel = 'Create an organization' } = {}) =>
    signedIn ? (
      <Link className="button" to={appHref}>
        Open {APP_NAME}
      </Link>
    ) : (
      <>
        <Link className="button" to={ROUTES.setup}>
          {primaryLabel}
        </Link>
        <Link className="button secondary" to={ROUTES.login}>
          Sign in
        </Link>
      </>
    );
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-inner landing-header-bar">
          <span className="brand">{APP_NAME}</span>
          <nav aria-label="Page sections">
            <ul>
              <li>
                <a href="#how-it-works">How it works</a>
              </li>
              <li>
                <a href="#features">What you get</a>
              </li>
            </ul>
          </nav>
          <div className="landing-actions">{actions({ primaryLabel: 'Get started' })}</div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="landing-band landing-hero">
          <div className="landing-inner">
            <h1>Know where your equipment is.</h1>
            <p className="lede">
              {APP_NAME} is a shared catalog for the gear your organization lends out — laptops,
              cameras, projectors, whatever sits on the shelf — with a request, an approval and a
              return behind every item that leaves it.
            </p>
            <div className="landing-actions">{actions()}</div>
            {signedIn ? null : (
              <p className="hint">
                Creating an organization makes you its first administrator. You can invite the rest
                of the team once you are in.
              </p>
            )}
          </div>
        </section>
        <section className="landing-band" id="how-it-works" aria-labelledby="how-it-works-heading">
          <div className="landing-inner">
            <h2 id="how-it-works-heading">How it works</h2>
            <ol className="landing-steps">
              {STEPS.map((step) => (
                <li key={step.title} className="card">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          className="landing-band landing-band--tint"
          id="features"
          aria-labelledby="features-heading"
        >
          <div className="landing-inner">
            <h2 id="features-heading">What you get</h2>
            <ul className="landing-features">
              {FEATURES.map((feature) => (
                <li key={feature.title}>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="landing-band landing-closing" aria-labelledby="closing-heading">
          <div className="landing-inner">
            <h2 id="closing-heading">Ready to see where your equipment is?</h2>
            <div className="landing-actions">{actions()}</div>
          </div>
        </section>
      </main>
      <footer className="app-footer">{APP_NAME} · CS673 Team 3 · Iteration 1</footer>
    </div>
  );
}

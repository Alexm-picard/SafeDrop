// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: landing page tests: public at `/`, sign-in/sign-up calls to action, signed-in variant, heading structure
// Human Contributions:
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Tests for the public landing page.
 *
 * Two things matter here and the rest is copy. First, `/` must be reachable *without* a session —
 * the whole point of the page is that it is what a stranger sees — so one test mounts the real route
 * table as a signed-out visitor and checks they are not bounced to the login form. Second, the page's
 * job is to get someone to the right place: the calls to action are asserted by where they point, not
 * by how they read.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LandingPage } from '../../../src/pages/LandingPage';
import { LoginPage } from '../../../src/pages/LoginPage';
import { adminUser, memberUser } from '../../mocks/handlers';
import { anonymousState, renderApp, renderWithAuth } from '../../utils/render';

describe('LandingPage', () => {
  it('is what a visitor with no session sees at /, instead of the login form', async () => {
    const { router } = renderApp('/', anonymousState);
    expect(
      await screen.findByRole('heading', { level: 1, name: /know where your equipment is/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('offers a visitor both ways in', () => {
    renderWithAuth(<LandingPage />);
    for (const link of screen.getAllByRole('link', {
      name: /create an organization|get started/i,
    })) {
      expect(link).toHaveAttribute('href', '/setup');
    }
    const signIn = screen.getAllByRole('link', { name: 'Sign in' });
    expect(signIn.length).toBeGreaterThan(0);
    for (const link of signIn) {
      expect(link).toHaveAttribute('href', '/login');
    }
  });

  it('takes a visitor to the sign-in form when they ask for it', async () => {
    const user = userEvent.setup();
    const { router } = renderWithAuth(<LandingPage />, {
      extraRoutes: [{ path: '/login', element: <LoginPage /> }],
    });
    await user.click(screen.getAllByRole('link', { name: 'Sign in' })[0]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it.each([
    ['an admin', adminUser, '/admin'],
    ['a member', memberUser, '/requests'],
  ])('sends %s who is already signed in back into the app', (_label, user, destination) => {
    renderWithAuth(<LandingPage />, { user });
    for (const link of screen.getAllByRole('link', { name: /open safedrop/i })) {
      expect(link).toHaveAttribute('href', destination);
    }
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create an organization/i })).not.toBeInTheDocument();
  });

  it('explains the flow in order, and what the product does', () => {
    renderWithAuth(<LandingPage />);
    const steps = within(screen.getByRole('region', { name: 'How it works' })).getAllByRole(
      'listitem',
    );
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent(/browse the catalog/i);
    expect(steps.at(-1)).toHaveTextContent(/get it back/i);
    expect(
      within(screen.getByRole('region', { name: 'What you get' })).getAllByRole('listitem'),
    ).toHaveLength(4);
  });

  it('has one h1 and a skip link, like every other page in the app', () => {
    const { container } = renderWithAuth(<LandingPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('.skip-link')).toHaveAttribute('href', '#main');
    expect(container.querySelector('main')).toHaveAttribute('id', 'main');
  });
});

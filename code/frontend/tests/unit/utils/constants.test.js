// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: unit tests for landingFor(), the post-sign-in destination map (SCRUM-21)
// Human Contributions: pending team review
// Notes: Written for SCRUM-21. Must be reviewed and tested by the owning team member before merge.

/**
 * Tests for the role → landing-screen map used after signing in (SCRUM-21).
 *
 * LoginPage.test.jsx already proves the three roles land where they should by driving the real
 * router. What is left to pin down here is the fallback: an unrecognised, missing or null role must
 * still resolve to a path every signed-in user may open, because a role added on the backend before
 * this map is updated would otherwise navigate to `undefined`.
 */
import { describe, expect, it } from 'vitest';
import { landingFor, LANDING_BY_ROLE, ROLES, ROUTES } from '../../../src/utils/constants';

describe('landingFor', () => {
  it('sends each role to its own screen', () => {
    expect(landingFor(ROLES.MEMBER)).toBe(ROUTES.myRequests);
    expect(landingFor(ROLES.APPROVER)).toBe(ROUTES.approvals);
    expect(landingFor(ROLES.ORG_ADMIN)).toBe(ROUTES.admin);
  });

  it('falls back to the catalog for an unknown, missing or null role', () => {
    expect(landingFor('SUPER_ADMIN')).toBe(ROUTES.home);
    expect(landingFor(undefined)).toBe(ROUTES.home);
    expect(landingFor(null)).toBe(ROUTES.home);
  });

  it('covers every role the SPA knows about', () => {
    expect(Object.keys(LANDING_BY_ROLE).sort()).toEqual(Object.values(ROLES).sort());
  });
});

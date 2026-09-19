// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: permission matrix tests mirroring SDD §6.4
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for the permission matrix (SDD §6.4, SR-1).
 *
 * Asserts the matrix against a literal copy of the table in the design document, so a permission
 * silently added to or removed from a role fails the build rather than changing the system quietly.
 *
 * It also pins deny-by-default from both directions: unknown roles and unknown permissions answer
 * false, exactly three routes are public, and `authorize()` refuses at build time to create middleware
 * for a permission nobody declared.
 */
import { describe, expect, it } from 'vitest';
import { authorize } from '../../../src/middleware/authorize.js';
import { AuthError, ForbiddenError } from '../../../src/utils/errors.js';
import {
  isPublicRoute,
  PERMISSIONS,
  ROLE_LIST,
  roleHasPermission,
} from '../../../src/utils/permissions.js';

const matrix = {
  'assets:read': ['MEMBER', 'APPROVER', 'ORG_ADMIN'],
  'requests:create': ['MEMBER', 'APPROVER', 'ORG_ADMIN'],
  'requests:read:own': ['MEMBER', 'APPROVER', 'ORG_ADMIN'],
  'session:self': ['MEMBER', 'APPROVER', 'ORG_ADMIN'],
  'password:self': ['MEMBER', 'APPROVER', 'ORG_ADMIN'],
  'requests:decide': ['APPROVER', 'ORG_ADMIN'],
  'requests:handoff': ['APPROVER', 'ORG_ADMIN'],
  'assets:write': ['ORG_ADMIN'],
  'users:manage': ['ORG_ADMIN'],
  'audit:read': ['ORG_ADMIN'],
  'dashboard:read': ['ORG_ADMIN'],
};

describe('permission matrix (SDD §6.4)', () => {
  it('lists exactly the documented permissions', () => {
    expect(Object.values(PERMISSIONS).sort()).toEqual(Object.keys(matrix).sort());
  });

  it.each(Object.entries(matrix))('%s is granted to %j and nobody else', (permission, roles) => {
    for (const role of ROLE_LIST) {
      expect(roleHasPermission(role, permission)).toBe(roles.includes(role));
    }
  });

  it('denies unknown roles and unknown permissions', () => {
    expect(roleHasPermission('ROOT', 'assets:read')).toBe(false);
    expect(roleHasPermission('ORG_ADMIN', 'everything')).toBe(false);
    expect(roleHasPermission(undefined, undefined)).toBe(false);
  });

  it('recognises exactly the three public routes', () => {
    expect(isPublicRoute('POST', '/api/auth/login')).toBe(true);
    expect(isPublicRoute('post', '/api/auth/refresh/')).toBe(true);
    expect(isPublicRoute('POST', '/api/organizations?x=1')).toBe(true);
    // The invitation-link route no longer exists: creating a member is an authenticated, admin-only act.
    expect(isPublicRoute('POST', '/api/auth/accept-invite')).toBe(false);
    expect(isPublicRoute('GET', '/api/organizations')).toBe(false);
    expect(isPublicRoute('POST', '/api/auth/logout')).toBe(false);
  });
});

describe('authorize()', () => {
  it('refuses to build a middleware for an undeclared permission', () => {
    expect(() => authorize('assets:delete')).toThrow(TypeError);
    expect(() => authorize()).toThrow(TypeError);
  });

  it('401 without req.auth, 403 without the permission, grants otherwise', () => {
    const mw = authorize('assets:write');
    const res = { locals: {} };
    let err;
    mw({}, res, (e) => (err = e));
    expect(err).toBeInstanceOf(AuthError);
    mw({ auth: { role: 'MEMBER' } }, res, (e) => (err = e));
    expect(err).toBeInstanceOf(ForbiddenError);
    err = 'unset';
    mw({ auth: { role: 'ORG_ADMIN' } }, res, (e) => (err = e));
    expect(err).toBeUndefined();
    expect(res.locals).toEqual({ permissionGate: 'granted', permission: 'assets:write' });
    expect(mw.permission).toBe('assets:write');
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the member-lifecycle ticket)
// AI-Assisted Areas: unit tests for the member-lifecycle building blocks: role ordering, invite/role/change-password/accept-invite schemas, repository additions, service edge cases
// Human Contributions: pending team review
// Notes: Complements tests/integration/routes/users.test.js, which covers the HTTP behaviour. Must be reviewed by the owning team member before merge.

/**
 * Unit tests for the pieces the member-lifecycle service is built from.
 *
 * The HTTP-level behaviour is proven in users.test.js; this file pins the assumptions underneath it,
 * so that a change to one of them fails *here*, with a message that names it, rather than as a
 * puzzling failure three layers up. The one that most deserves a test of its own is the ordering of
 * `ROLE_LIST`: the service decides whether a change is a demotion by comparing positions in that
 * list, so reordering it would silently invert which changes revoke a session.
 */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import * as orgRepo from '../../../src/repositories/organization.repository.js';
import * as userRepo from '../../../src/repositories/user.repository.js';
import { acceptInviteBody, changePasswordBody } from '../../../src/routes/auth.routes.js';
import { inviteBody, roleBody } from '../../../src/routes/users.routes.js';
import * as organizationService from '../../../src/services/organization.service.js';
import { ForbiddenError, NotFoundError } from '../../../src/utils/errors.js';
import { ROLE_LIST, ROLES } from '../../../src/utils/permissions.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

describe('ROLE_LIST ordering', () => {
  it('runs from least to most privileged, which isDemotion() in organization.service relies on', () => {
    expect([...ROLE_LIST]).toEqual([ROLES.MEMBER, ROLES.APPROVER, ROLES.ORG_ADMIN]);
  });
});

describe('inviteBody', () => {
  const base = { email: 'a@b.co', name: 'A' };

  it('defaults the role to MEMBER, the least privilege', () => {
    expect(inviteBody.parse(base).role).toBe(ROLES.MEMBER);
  });

  it('trims and lower-cases the email', () => {
    expect(inviteBody.parse({ ...base, email: '  A@B.Co ' }).email).toBe('a@b.co');
  });

  it('has no field for a password or an organisation: an admin can choose neither', () => {
    expect(Object.keys(inviteBody.shape).sort()).toEqual(['email', 'name', 'role']);
  });
});

describe('acceptInviteBody', () => {
  const ok = { token: 'a'.repeat(43), password: 'Long-Enough-Passw0rd' };

  it('accepts a token-shaped string and a password that meets the rules', () => {
    expect(acceptInviteBody.safeParse(ok).success).toBe(true);
  });

  it('holds the password to the shared rules: 10 characters minimum, 72 bytes maximum', () => {
    expect(acceptInviteBody.safeParse({ ...ok, password: 'short' }).success).toBe(false);
    expect(acceptInviteBody.safeParse({ ...ok, password: 'a'.repeat(73) }).success).toBe(false);
  });

  it('bounds the token so an absurd body is refused before any hashing', () => {
    expect(acceptInviteBody.safeParse({ ...ok, token: 'short' }).success).toBe(false);
    expect(acceptInviteBody.safeParse({ ...ok, token: 'a'.repeat(201) }).success).toBe(false);
    expect(acceptInviteBody.safeParse({ ...ok, token: { $ne: null } }).success).toBe(false);
  });

  it('requires both fields', () => {
    expect(acceptInviteBody.safeParse({ password: ok.password }).success).toBe(false);
    expect(acceptInviteBody.safeParse({ token: ok.token }).success).toBe(false);
  });
});

describe('changePasswordBody', () => {
  const ok = { currentPassword: 'anything', newPassword: 'Long-Enough-Passw0rd' };

  it('accepts a current password of any content and a new one that meets the rules', () => {
    expect(changePasswordBody.safeParse(ok).success).toBe(true);
    // The current password is compared, not set, so its format is not policed.
    expect(changePasswordBody.safeParse({ ...ok, currentPassword: 'x' }).success).toBe(true);
  });

  it('holds the new password to the shared rules: 10 characters minimum, 72 bytes maximum', () => {
    expect(changePasswordBody.safeParse({ ...ok, newPassword: 'short' }).success).toBe(false);
    expect(changePasswordBody.safeParse({ ...ok, newPassword: 'a'.repeat(73) }).success).toBe(
      false,
    );
    // Multi-byte characters count as bytes: 25 × 3 = 75 > 72.
    expect(changePasswordBody.safeParse({ ...ok, newPassword: '€'.repeat(25) }).success).toBe(
      false,
    );
  });

  it('requires both fields', () => {
    expect(changePasswordBody.safeParse({ newPassword: ok.newPassword }).success).toBe(false);
    expect(changePasswordBody.safeParse({ currentPassword: 'x' }).success).toBe(false);
    expect(changePasswordBody.safeParse({ ...ok, currentPassword: '' }).success).toBe(false);
  });
});

describe('roleBody', () => {
  it.each(ROLE_LIST)('accepts %s', (role) => {
    expect(roleBody.parse({ role })).toEqual({ role });
  });

  it.each([undefined, null, '', 'admin', 'ORG_ADMINS', 7, {}])('rejects %j', (role) => {
    expect(roleBody.safeParse({ role }).success).toBe(false);
  });
});

describe('repository additions', () => {
  let seed;
  beforeEach(async () => {
    seed = await seedTwoOrgs();
  });

  it('countByRole counts within one organisation only', async () => {
    expect(await userRepo.countByRole(seed.a.orgId, ROLES.ORG_ADMIN)).toBe(1);
    expect(await userRepo.countByRole(seed.a.orgId, ROLES.MEMBER)).toBe(1);
    await userRepo.updateRole(seed.b.orgId, seed.b.member._id, ROLES.ORG_ADMIN);
    // B now has two admins; A still has one.
    expect(await userRepo.countByRole(seed.b.orgId, ROLES.ORG_ADMIN)).toBe(2);
    expect(await userRepo.countByRole(seed.a.orgId, ROLES.ORG_ADMIN)).toBe(1);
  });

  it('findById and findRole still miss a user from another organisation, with or without a session', async () => {
    expect(await userRepo.findById(seed.a.orgId, seed.b.member._id)).toBeNull();
    expect(await userRepo.findRole(seed.a.orgId, seed.b.member._id)).toBeNull();

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        expect(await userRepo.findById(seed.a.orgId, seed.b.member._id, { session })).toBeNull();
        expect(await userRepo.findRole(seed.a.orgId, seed.b.member._id, { session })).toBeNull();
        expect(await userRepo.findRole(seed.a.orgId, seed.a.admin._id, { session })).toBe(
          ROLES.ORG_ADMIN,
        );
      });
    } finally {
      await session.endSession();
    }
  });

  it('orgRepo.touch reports whether the organisation exists', async () => {
    expect(await orgRepo.touch(seed.a.orgId)).toBe(true);
    expect(await orgRepo.touch(new mongoose.Types.ObjectId())).toBe(false);
  });
});

describe('member-lifecycle service edge cases', () => {
  let seed;
  beforeEach(async () => {
    seed = await seedTwoOrgs();
  });

  it('listUsers works with no query at all and returns public users', async () => {
    const result = await organizationService.listUsers(seed.a.orgId);
    expect(result).toMatchObject({ total: 3, page: 1, limit: 50 });
    expect(
      result.items.every((u) => u.passwordHash === undefined && typeof u.id === 'string'),
    ).toBe(true);
  });

  it('inviteUser refuses a caller who no longer exists, and creates nothing', async () => {
    const ghost = { userId: String(new mongoose.Types.ObjectId()) };
    await expect(
      organizationService.inviteUser(seed.a.orgId, ghost, { email: 'x@a.test', name: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await userRepo.findByEmail(seed.a.orgId, 'x@a.test')).toBeNull();
  });

  it('inviteUser refuses a caller from a different organisation than the one it is acting in', async () => {
    // B's admin is a real admin, but not *in* A: the role lookup is tenant-scoped, so it finds no one.
    await expect(
      organizationService.inviteUser(
        seed.a.orgId,
        { userId: String(seed.b.admin._id) },
        { email: 'x@a.test', name: 'X' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('changeUserRole refuses a caller who no longer exists', async () => {
    const ghost = { userId: String(new mongoose.Types.ObjectId()) };
    await expect(
      organizationService.changeUserRole(
        seed.a.orgId,
        ghost,
        String(seed.a.member._id),
        'APPROVER',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await userRepo.findRole(seed.a.orgId, seed.a.member._id)).toBe(ROLES.MEMBER);
  });

  it('changeUserRole checks the caller before looking for the target, so a non-admin learns nothing about ids', async () => {
    const memberActor = { userId: String(seed.a.member._id) };
    // A non-existent target: an unauthorised caller must get 403, not the 404 that would reveal it is absent.
    await expect(
      organizationService.changeUserRole(
        seed.a.orgId,
        memberActor,
        String(new mongoose.Types.ObjectId()),
        'APPROVER',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('changeUserRole reports a missing target as NotFoundError for an admin', async () => {
    await expect(
      organizationService.changeUserRole(
        seed.a.orgId,
        { userId: String(seed.a.admin._id) },
        String(new mongoose.Types.ObjectId()),
        'APPROVER',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

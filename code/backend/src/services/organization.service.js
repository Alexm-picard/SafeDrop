// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: organisation bootstrap (org + first ORG_ADMIN + ORG_CREATED audit in one transaction, SCRUM-101); user-management stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { withTransaction } from '../config/db.js';
import * as orgRepo from '../repositories/organization.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../utils/constants.js';
import { ConflictError, NotImplementedError, ValidationError } from '../utils/errors.js';
import { ROLES } from '../utils/permissions.js';
import { slugify } from '../utils/slug.js';
import { record as recordAudit } from './audit.service.js';
import { hashPassword, publicUser, startSession } from './auth.service.js';

export { slugify };

/**
 * POST /api/organizations (SCRUM-101). Creates the organisation and its first ORG_ADMIN and appends
 * the ORG_CREATED audit event, all inside one transaction (OD-2): a failure anywhere creates nothing.
 * Also starts the admin's session so the SPA can go straight to the dashboard.
 * @param {{ orgName: string, adminName: string, adminEmail: string, adminPassword: string, requestId?: string }} input
 */
export async function createOrganization({
  orgName,
  adminName,
  adminEmail,
  adminPassword,
  requestId,
}) {
  const slug = slugify(orgName);
  if (!slug) {
    throw new ValidationError('Invalid request', [
      { location: 'body', path: 'orgName', message: 'must contain at least one letter or digit' },
    ]);
  }
  if (await orgRepo.findBySlug(slug)) {
    throw new ConflictError('An organisation with a similar name already exists', {
      field: 'orgName',
    });
  }
  const passwordHash = await hashPassword(adminPassword);

  return withTransaction(async (session) => {
    const org = await orgRepo.create({ name: orgName, slug }, { session });
    const admin = await userRepo.create(
      org._id,
      { email: adminEmail, name: adminName, role: ROLES.ORG_ADMIN, passwordHash },
      { session },
    );
    await recordAudit(
      org._id,
      {
        actor: { userId: admin._id, role: admin.role },
        action: AUDIT_ACTION.ORG_CREATED,
        targetType: AUDIT_TARGET_TYPE.Organization,
        targetId: org._id,
        before: null,
        after: { name: org.name, slug: org.slug, firstAdminId: String(admin._id) },
        requestId,
      },
      { session },
    );
    const tokens = await startSession(admin, { session });
    return {
      organization: {
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
      },
      user: publicUser(admin),
      ...tokens,
    };
  });
}

// ---- User management (Sprint 1 stubs) -----------------------------------------------------------

/** GET /api/users — TODO(SCRUM-users-list): ORG_ADMIN lists members of their own org only. */
export async function listUsers(_orgId, _query) {
  throw new NotImplementedError('SCRUM-users-list', 'User listing is not implemented yet');
}

/**
 * POST /api/users/invite — TODO(SCRUM-users-invite): ORG_ADMIN invites by email; creates the user
 * in the admin's org (OD-3) and appends USER_INVITED in the same transaction.
 */
export async function inviteUser(_orgId, _actor, _input) {
  throw new NotImplementedError('SCRUM-users-invite', 'User invitation is not implemented yet');
}

/**
 * PATCH /api/users/:id/role — TODO(SCRUM-users-role): re-read the actor's role from the DB (not the
 * token) via userRepo.findRole before allowing the change (SDD §6.2); append USER_ROLE_CHANGED with
 * before/after in the same transaction; an admin cannot demote the last ORG_ADMIN.
 */
export async function changeUserRole(_orgId, _actor, _userId, _role) {
  throw new NotImplementedError('SCRUM-users-role', 'Role changes are not implemented yet');
}

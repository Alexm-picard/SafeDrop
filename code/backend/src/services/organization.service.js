// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: organisation bootstrap (org + first ORG_ADMIN + ORG_CREATED audit in one transaction, SCRUM-101); user-management stubs
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Organisation lifecycle and user administration.
 *
 * The implemented half is `createOrganization()`, the system's bootstrap: it creates a tenant, its
 * first ORG_ADMIN, the ORG_CREATED audit event and the admin's session, all in one transaction. The
 * user-management half is Sprint 1 stubs — the routes, permissions and audit obligations are settled,
 * the behaviour belongs to later tickets.
 *
 * Exports: `createOrganization`, `listUsers` (stub), `inviteUser` (stub), `changeUserRole` (stub), and
 * a re-export of `slugify`.
 */
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
 * Create an organisation with its first administrator (`POST /api/organizations`, SCRUM-101).
 *
 * This is the one route that creates a privileged account without a privileged caller, so everything
 * about it is deliberate. The slug is derived from the name and must survive slugification — a name
 * of nothing but punctuation is a 400. An existing slug is a 409 before any work is done, though the
 * unique index remains the real guarantee against two concurrent creations.
 *
 * The password is hashed *outside* the transaction: bcrypt at cost 12 takes appreciable time, and
 * holding a MongoDB transaction open across it would lock rows for no reason.
 *
 * Inside the transaction the organisation, the admin, the ORG_CREATED audit event and the admin's
 * session are created together (OD-2), so a failure at any step leaves no half-built tenant — no
 * organisation without an admin, no admin without an audit record.
 *
 * The session is started here, rather than making the new admin log in, so the SPA can go straight
 * to the dashboard.
 * @param {{ orgName: string, adminName: string, adminEmail: string, adminPassword: string, requestId?: string }} input
 * @returns {Promise<{ organization: object, user: object, accessToken: string, accessExpiresAt: Date, refreshToken: string, refreshExpiresAt: Date, refreshTokenId: string }>}
 * @throws {ValidationError} (400) when the name yields an empty slug
 * @throws {ConflictError} (409) when the slug is taken
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

/**
 * List the organisation's members (`GET /api/users`) — not implemented yet.
 *
 * TODO(SCRUM-users-list): an ORG_ADMIN lists members of their own organisation only, paginated via
 * `userRepo.list()`.
 * @param {string} _orgId
 * @param {object} _query
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function listUsers(_orgId, _query) {
  throw new NotImplementedError('SCRUM-users-list', 'User listing is not implemented yet');
}

/**
 * Invite a new member (`POST /api/users/invite`) — not implemented yet.
 *
 * TODO(SCRUM-users-invite): create the user in the *admin's own* organisation (never one named by
 * the request — OD-3, SR-2) and append USER_INVITED in the same transaction.
 * @param {string} _orgId
 * @param {object} _actor
 * @param {object} _input
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function inviteUser(_orgId, _actor, _input) {
  throw new NotImplementedError('SCRUM-users-invite', 'User invitation is not implemented yet');
}

/**
 * Change a member's role (`PATCH /api/users/:id/role`) — not implemented yet.
 *
 * TODO(SCRUM-users-role). Three requirements the implementation must meet:
 *  - re-read the *actor's* role from the database with `userRepo.findRole()` rather than trusting the
 *    token, so a just-demoted admin cannot use an old token to promote themselves (SDD §6.2);
 *  - append USER_ROLE_CHANGED with before/after in the same transaction;
 *  - refuse to demote the last ORG_ADMIN, which would leave the organisation unadministrable.
 * @param {string} _orgId
 * @param {object} _actor
 * @param {string} _userId
 * @param {string} _role
 * @throws {NotImplementedError} (501) until the ticket is delivered
 */
export async function changeUserRole(_orgId, _actor, _userId, _role) {
  throw new NotImplementedError('SCRUM-users-role', 'Role changes are not implemented yet');
}

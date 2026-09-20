// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents; member lifecycle implemented from the ticket)
// AI-Assisted Areas: organisation bootstrap (org + first ORG_ADMIN + ORG_CREATED audit in one transaction, SCRUM-101); member lifecycle: list, invite (admin-set initial password), change role (SCRUM-users-list / -invite / -role)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog, then extended for the member-lifecycle ticket. Verified by tests/integration/routes/users.test.js and tests/unit/services/userManagement.test.js.

/**
 * Organisation lifecycle and member administration.
 *
 * `createOrganization()` is the system's bootstrap: it creates a tenant, its first ORG_ADMIN, the
 * ORG_CREATED audit event and the admin's session, all in one transaction. Everything after that is
 * member management — `listUsers`, `inviteUser` and `changeUserRole` — which is how an organisation
 * grows beyond its founding admin. All three act on the *caller's own* organisation: the tenant is
 * passed in from the verified token and never read from the request (SR-2).
 *
 * Exports: `createOrganization`, `listUsers`, `inviteUser`, `changeUserRole`, `setUserPassword`,
 * and a re-export of `slugify`.
 */
import { withTransaction } from '../config/db.js';
import * as orgRepo from '../repositories/organization.repository.js';
import * as refreshRepo from '../repositories/refreshToken.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../utils/constants.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { PERMISSIONS, ROLE_LIST, ROLES, roleHasPermission } from '../utils/permissions.js';
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

// ---- Member lifecycle ---------------------------------------------------------------------------

/** Error message for an email that is already a member of the organisation. */
const DUPLICATE_EMAIL = 'A member with this email already exists in your organisation';

/**
 * Is moving from `from` to `to` a loss of privilege?
 *
 * `ROLE_LIST` runs from least to most privileged and the roles are cumulative (utils/permissions.js),
 * so a lower index in the list is strictly fewer permissions. A unit test pins that ordering, since
 * this function would silently invert if someone reordered the list.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
const isDemotion = (from, to) => ROLE_LIST.indexOf(to) < ROLE_LIST.indexOf(from);

/**
 * Confirm, from the database, that the caller may still manage members, and return their current role.
 *
 * An access token carries the role it was minted with and stays valid for up to its TTL, so a
 * just-demoted admin would otherwise keep `users:manage` until it expired — long enough to promote
 * themselves back or invite an accomplice (SDD §6.2). This re-reads the role instead, so a demotion
 * takes effect immediately for the one router that can change who holds authority.
 *
 * Runs inside the caller's transaction, so on a retry after a write conflict the check is made again
 * against the new state. A missing actor (deleted since the token was issued) is refused the same
 * way as a demoted one.
 * @param {string} orgId
 * @param {{ userId: string }} actor the verified caller (`req.auth`)
 * @param {import('mongoose').ClientSession} session
 * @returns {Promise<string>} the actor's current role, for the audit event
 * @throws {ForbiddenError} (403) when the actor no longer holds `users:manage`
 */
async function currentManagerRole(orgId, actor, session) {
  const role = await userRepo.findRole(orgId, actor.userId, { session });
  if (!role || !roleHasPermission(role, PERMISSIONS.USERS_MANAGE)) {
    throw new ForbiddenError();
  }
  return role;
}

/**
 * List the organisation's members (`GET /api/users`), oldest first, paginated.
 *
 * Only public fields are returned — `publicUser()` is an allow-list, so no hash and no future column
 * leaks by default. The tenant comes from the token, so an admin sees their own organisation's
 * members and nobody else's (SR-2).
 *
 * Unlike the two mutations below this does not re-read the caller's role: it changes nothing, and
 * the route's `users:manage` check already applies to the token's role.
 * @param {string} orgId the caller's organisation
 * @param {{ page?: number, limit?: number }} [query] validated by the route's `pagination` schema
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function listUsers(orgId, query = {}) {
  const { items, total, page, limit } = await userRepo.list(orgId, query);
  return { items: items.map(publicUser), total, page, limit };
}

// AI-ASSISTED: YES
//   Tool: Claude Code
//   Prompt Summary: "Implement invite: create a user in the admin's own org with the role chosen and an
//   initial password the admin sets and shares out of band; append USER_INVITED in the same
//   transaction; duplicate email in the org is a 409." (no email service, no invitation link)
//   AI Contribution: Initial draft and tests (~100% of the first version).
//   Modifications: none yet — pending review by the owning team member.
//   Verification:
//   - Integration tests (tests/integration/routes/users.test.js)
//   - Unit tests (tests/unit/services/userManagement.test.js)
//   Confidence: Medium-High; the Security lead should review the shared initial password.
/**
 * Invite a new member into the caller's organisation (`POST /api/users/invite`, SDD OD-3).
 *
 * The user is created in the *admin's own* organisation — `orgId` is the token's, and the body schema
 * has no organisation field, so a request cannot name another tenant (SR-2, mass-assignment defence).
 *
 * Iteration 1 has no email service, so the admin **sets the member's initial password** and shares it
 * out of band. It is validated by the same schema as any password (length, 72-byte cap), hashed with
 * bcrypt, and never returned, logged or audited: the response and the USER_INVITED event describe the
 * member, not the credential. The member signs in with the organisation code, their email and that
 * password. Email delivery is deferred to Iteration 2 alongside forgotten-password.
 *
 * **Known limitation, accepted for Iteration 1:** the admin knows the member's password, and nothing
 * makes the member change it. That sits uneasily with non-repudiation (SR-10); a change-password screen
 * and a forced change at first sign-in are the follow-up.
 *
 * Order of work, and why:
 *  1. A duplicate email is refused with 409 *before* the bcrypt hash is computed — hashing at cost 12 is
 *     slow, and there is no reason to spend it on a request that cannot succeed. Uniqueness is per
 *     organisation (OD-3): the same address in another organisation is fine.
 *  2. The password is hashed *outside* the transaction, for the same reason `createOrganization` does:
 *     never hold a transaction open across bcrypt.
 *  3. Inside the transaction the caller's role is re-read from the database (see `currentManagerRole`),
 *     the user is created, and USER_INVITED is appended, so the account and the evidence of who created
 *     it commit together or not at all (OD-2, SR-9).
 *
 * The check in step 1 is a courtesy; the `orgId_email_unique` index is the real guarantee. Two
 * concurrent invitations for one address both pass step 1, and the loser of the race hits the index —
 * translated here to the same 409 rather than leaking a raw duplicate-key error.
 *
 * The invitee can hold any role, including ORG_ADMIN: `users:manage` is what gates this.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string }} actor the verified caller (`req.auth`)
 * @param {{ email: string, name: string, password: string, role?: string }} input validated by `inviteBody`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ user: object }>} the new member (never their password)
 * @throws {ConflictError} (409) when the email is already a member of this organisation
 * @throws {ForbiddenError} (403) when the caller has been demoted since their token was issued
 */
export async function inviteUser(orgId, actor, input, { requestId } = {}) {
  const { email, name, password, role = ROLES.MEMBER } = input;
  if (await userRepo.findByEmail(orgId, email)) {
    throw new ConflictError(DUPLICATE_EMAIL, { field: 'email' });
  }
  const passwordHash = await hashPassword(password);

  try {
    const user = await withTransaction(async (session) => {
      const actorRole = await currentManagerRole(orgId, actor, session);
      const created = await userRepo.create(
        orgId,
        // The admin typed this password and will send it over some channel, so the account is
        // confined to the change-password screen until the member picks their own (SCRUM-22).
        { email, name, role, passwordHash, mustChangePassword: true },
        { session },
      );
      await recordAudit(
        orgId,
        {
          actor: { userId: actor.userId, role: actorRole },
          action: AUDIT_ACTION.USER_INVITED,
          targetType: AUDIT_TARGET_TYPE.User,
          targetId: created._id,
          before: null,
          after: { email: created.email, name: created.name, role: created.role },
          requestId,
        },
        { session },
      );
      return created;
    });
    return { user: publicUser(user) };
  } catch (err) {
    if (err && err.code === 11000) {
      throw new ConflictError(DUPLICATE_EMAIL, { field: 'email' });
    }
    throw err;
  }
}

// AI-ASSISTED: YES
//   Tool: Claude Code
//   Prompt Summary: "Implement change-role: re-read the actor's role from the DB, append
//   USER_ROLE_CHANGED with before/after in the same transaction, refuse to demote the last ORG_ADMIN."
//   AI Contribution: Initial draft and tests (~100% of the first version).
//   Modifications: none yet — pending review by the owning team member.
//   Verification:
//   - Integration tests (tests/integration/routes/users.test.js), including a concurrent
//     mutual-demotion test for the last-admin rule
//   - Unit tests (tests/unit/services/userManagement.test.js)
//   Confidence: Medium-High; the Security lead should review the serialisation and revocation choices.
/**
 * Change a member's role (`PATCH /api/users/:id/role`).
 *
 * Everything happens in one transaction, and the order matters:
 *
 *  1. **Serialise.** The organisation document is written first (`orgRepo.touch`). Snapshot isolation
 *     would otherwise let two admins demoting each other both read "two admins remain" and both
 *     commit, leaving the organisation with none. A write to one shared document makes those
 *     transactions conflict instead; MongoDB aborts one and `withTransaction` retries it against the
 *     new state, so the last-admin rule holds under concurrency, not just in a single request.
 *  2. **Re-read the caller's role** from the database rather than the token (SDD §6.2), so a
 *     just-demoted admin cannot use an unexpired token to change roles. Because the retry re-runs
 *     this too, a caller demoted by the winner of a race is refused when their turn comes.
 *  3. **Find the target in the caller's organisation.** A user from another tenant is simply not
 *     found — 404, never 403, which would confirm the id exists (SR-2).
 *  4. **Refuse to demote the last ORG_ADMIN** with 409: the organisation would be unadministrable, and
 *     nobody could invite anyone or promote anyone to fix it.
 *  5. **Apply the change and append USER_ROLE_CHANGED** with before/after, together.
 *
 * Two behaviours worth knowing:
 *  - Setting a member to the role they already hold is a no-op: 200 with the user, and no audit event,
 *    because nothing changed and an audit trail full of non-events hides the real ones.
 *  - A *demotion* revokes every refresh token the member holds (as `userRepo.updateRole` advises), so
 *    they must sign in again once their current access token lapses. It does not shorten that access
 *    token: it keeps the old role for at most `JWT_ACCESS_TTL`, on every route except the
 *    `users:manage` ones, which re-read the role from the database. Refresh already re-reads the role
 *    too, so revocation is defence in depth rather than the mechanism. A promotion needs none of this:
 *    the new role is picked up at the next refresh.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string }} actor the verified caller (`req.auth`)
 * @param {string} userId the member whose role changes, from the URL
 * @param {string} role the new role, validated by `roleBody`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ user: object }>} the member with their current role
 * @throws {ForbiddenError} (403) when the caller has been demoted since their token was issued
 * @throws {NotFoundError} (404) when the user is not in the caller's organisation
 * @throws {ConflictError} (409) when this would demote the organisation's last ORG_ADMIN
 */
export async function changeUserRole(orgId, actor, userId, role, { requestId } = {}) {
  return withTransaction(async (session) => {
    await orgRepo.touch(orgId, { session });
    const actorRole = await currentManagerRole(orgId, actor, session);

    const target = await userRepo.findById(orgId, userId, { session });
    if (!target) {
      throw new NotFoundError('User not found');
    }
    const before = target.role;
    if (before === role) {
      return { user: publicUser(target) };
    }
    if (
      before === ROLES.ORG_ADMIN &&
      (await userRepo.countByRole(orgId, ROLES.ORG_ADMIN, { session })) <= 1
    ) {
      throw new ConflictError('Cannot demote the last organisation admin', { field: 'role' });
    }

    const updated = await userRepo.updateRole(orgId, target._id, role, { session });
    if (isDemotion(before, role)) {
      await refreshRepo.revokeAllForUser(orgId, target._id, { session });
    }
    await recordAudit(
      orgId,
      {
        actor: { userId: actor.userId, role: actorRole },
        action: AUDIT_ACTION.USER_ROLE_CHANGED,
        targetType: AUDIT_TARGET_TYPE.User,
        targetId: target._id,
        before: { role: before },
        after: { role },
        requestId,
      },
      { session },
    );
    return { user: publicUser(updated) };
  });
}

/**
 * Set a member's password on their behalf (`POST /api/users/:id/password`, SCRUM-36).
 *
 * The fallback for someone who cannot use the emailed link — they have lost access to the mailbox,
 * or cannot remember which address the account uses. An admin types a password, tells the person
 * through a channel they trust, and the account is flagged `mustChangePassword`, so that password
 * buys exactly one thing: the change-password screen.
 *
 * Three consequences, all in one transaction with the audit entry (OD-2, SR-9):
 *  - the password changes;
 *  - every session the member had is revoked, because a forgotten password and a stolen one look
 *    identical from here;
 *  - `USER_PASSWORD_RESET` records which admin did it, to which account.
 *
 * An admin cannot aim this at themselves: doing so would lock their own session out of everything
 * but the change-password screen, for no gain over using it directly. Password strength is the
 * route schema's business, as at invitation.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string }} actor the verified caller (`req.auth`)
 * @param {string} userId the member whose password is being set
 * @param {{ password: string }} input validated by `setPasswordBody`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ user: object }>}
 * @throws {NotFoundError} (404) when no such member exists in this organisation (SR-2)
 * @throws {ConflictError} (409) when an admin aims it at their own account
 */
export async function setUserPassword(orgId, actor, userId, { password }, { requestId } = {}) {
  if (String(userId) === String(actor.userId)) {
    throw new ConflictError('Use change-password to set your own password', { field: 'id' });
  }
  // Outside the transaction: never hold one open across bcrypt.
  const passwordHash = await hashPassword(password);

  return withTransaction(async (session) => {
    const actorRole = await currentManagerRole(orgId, actor, session);
    const target = await userRepo.findById(orgId, userId, { session });
    if (!target) {
      throw new NotFoundError('User not found');
    }

    const updated = await userRepo.setPassword(orgId, target._id, passwordHash, {
      session,
      mustChangePassword: true,
    });
    await refreshRepo.revokeAllForUser(orgId, target._id, { session });
    await recordAudit(
      orgId,
      {
        actor: { userId: actor.userId, role: actorRole },
        action: AUDIT_ACTION.USER_PASSWORD_RESET,
        targetType: AUDIT_TARGET_TYPE.User,
        targetId: target._id,
        before: null,
        after: { mustChangePassword: true },
        requestId,
      },
      { session },
    );
    return { user: publicUser(updated) };
  });
}

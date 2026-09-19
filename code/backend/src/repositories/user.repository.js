// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped user persistence; passwordHash only via the explicit *WithPassword readers (SR-2, SR-3); session-aware reads, countByRole and setPassword for the member lifecycle
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; countByRole and the session options added for the member-lifecycle ticket.
//
// Every function takes orgId first. A document from another tenant is simply never matched, so the
// service layer turns `null` into a 404 (never a 403, which would confirm the id exists).

/**
 * Data access for the `users` collection.
 *
 * Every function takes `orgId` first and folds it into the filter, so a user from another tenant is
 * never matched and the service layer turns `null` into a 404 — never a 403, which would confirm that
 * the id exists somewhere (SR-2).
 *
 * Email is normalised (trimmed, lowercased) on the way in and on every lookup, so `Alex@Example.com `
 * and `alex@example.com` cannot become two accounts or fail to match at login. Because uniqueness is
 * per organisation (OD-3), every email lookup needs the tenant too.
 *
 * Reads that feed a decision made inside a transaction take an optional `{ session }`, so they see the
 * same snapshot as the writes that follow them.
 *
 * Exports: `create`, `findById`, `findByEmail`, `findByEmailWithPassword`, `findRole`, `updateRole`,
 * `list`, `countByOrg`, `countByRole`, `findByIdWithPassword`, `setPassword`.
 */
import { User } from '../models/User.js';

/**
 * Canonical form of an email address for storage and lookup: trimmed and lowercased.
 * @param {string} email
 * @returns {string}
 */
const normalizeEmail = (email) => String(email).trim().toLowerCase();

/**
 * Insert a user into one organisation.
 *
 * Takes an already-computed `passwordHash` — hashing is auth.service's job, and a repository that
 * accepted a plaintext password would invite one to be stored.
 * @param {string} orgId
 * @param {{ email: string, name: string, role: string, passwordHash: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create(orgId, { email, name, role, passwordHash }, { session } = {}) {
  const [doc] = await User.create(
    [{ orgId, email: normalizeEmail(email), name, role, passwordHash }],
    {
      session,
    },
  );
  return doc;
}

/**
 * Fetch one user by id, scoped to the tenant. `passwordHash` is not selected.
 * @param {string} orgId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findById(orgId, userId, { session } = {}) {
  return User.findOne({ _id: userId, orgId }).session(session ?? null);
}

/**
 * Fetch one user by email within a tenant. `passwordHash` is not selected.
 * @param {string} orgId
 * @param {string} email any case or surrounding whitespace
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findByEmail(orgId, email) {
  return User.findOne({ orgId, email: normalizeEmail(email) });
}

/**
 * Fetch one user *with* their password hash — the login path, and the only reader that asks for it.
 *
 * `passwordHash` is `select: false` on the schema, so it takes this explicit `+passwordHash` to
 * retrieve it. Keeping that opt-in in exactly one function is what makes "who can see the hashes?"
 * answerable by reading a single line.
 * @param {string} orgId
 * @param {string} email
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findByEmailWithPassword(orgId, email) {
  return User.findOne({ orgId, email: normalizeEmail(email) }).select('+passwordHash');
}

/**
 * Read a user's current role straight from the database, bypassing the token's copy.
 *
 * An access token carries the role it was minted with, so a demotion would otherwise stay invisible
 * until the token expired. Sensitive operations (`users:manage`) re-read the role here so a change
 * takes effect immediately (SDD §6.2). `lean()` because only the string is needed.
 * @param {string} orgId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<string|null>} the role, or null when no such user is in this tenant
 */
export async function findRole(orgId, userId, { session } = {}) {
  const doc = await User.findOne({ _id: userId, orgId })
    .select('role')
    .session(session ?? null)
    .lean();
  return doc ? doc.role : null;
}

/**
 * Change one user's role and return the updated document.
 *
 * `runValidators` keeps the role enum enforced on this update path. Note the caller's duty: a
 * demotion should usually be paired with `revokeAllForUser` so existing sessions cannot keep using
 * the old role until their access tokens expire.
 * @param {string} orgId
 * @param {string} userId
 * @param {string} role one of ROLE_LIST
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function updateRole(orgId, userId, role, { session } = {}) {
  return User.findOneAndUpdate(
    { _id: userId, orgId },
    { $set: { role } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * List the organisation's users, oldest first, paginated.
 *
 * Sorted by `createdAt` so the founding admin stays at the top and the order does not shift as
 * people are renamed. Backs the admin user-management view (`users:manage`).
 * @param {string} orgId
 * @param {{ page?: number, limit?: number }} [options]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.find({ orgId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
    User.countDocuments({ orgId }),
  ]);
  return { items, total, page, limit };
}

/**
 * Count the users in one organisation, for the dashboard summary.
 * @param {string} orgId
 * @returns {Promise<number>}
 */
export async function countByOrg(orgId) {
  return User.countDocuments({ orgId });
}

/**
 * Count the users in one organisation who hold a given role.
 *
 * Backs the "never demote the last ORG_ADMIN" rule. Pass the transaction's `session` so the count is
 * read from the same snapshot as the role change it is guarding.
 * @param {string} orgId
 * @param {string} role one of ROLE_LIST
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<number>}
 */
export async function countByRole(orgId, role, { session } = {}) {
  return User.countDocuments({ orgId, role }).session(session ?? null);
}

/**
 * Fetch one user by id *with* their password hash — for verifying the current password on a change.
 *
 * The second reader (after `findByEmailWithPassword`) that opts into `+passwordHash`. Login has no
 * user id yet, so it looks up by email; a password change is made by an already-authenticated caller,
 * so it looks up by id and there is no reason for it to go through an email.
 * @param {string} orgId
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findByIdWithPassword(orgId, userId) {
  return User.findOne({ _id: userId, orgId }).select('+passwordHash');
}

/**
 * Replace a user's password hash and return the updated document.
 *
 * Takes an already-computed hash, like `create` — hashing is auth.service's job.
 * @param {string} orgId
 * @param {string} userId
 * @param {string} passwordHash
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} the updated user (no hash selected), or null when not in this tenant
 */
export async function setPassword(orgId, userId, passwordHash, { session } = {}) {
  return User.findOneAndUpdate(
    { _id: userId, orgId },
    { $set: { passwordHash } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

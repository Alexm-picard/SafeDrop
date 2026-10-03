// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: tenant-scoped persistence for the usergroups collection, including race-safe membership changes (SCRUM-149)
// Human Contributions: pending review
// Notes: Written from the ticket's acceptance criteria and design notes. Must be reviewed and tested by the owning team member before merge.
//
// Every function takes orgId first. A group from another tenant is simply never matched, so the
// service layer turns `null` into a 404 (never a 403, which would confirm the id exists).

/**
 * Data access for the `usergroups` collection.
 *
 * `addMember` and `removeMember` are each a single conditional `findOneAndUpdate`, not a read-then-write:
 * the filter itself carries the precondition ("not already a member" / "currently a member"), so the
 * database decides the outcome of a concurrent double-add or double-remove rather than two requests
 * racing each other in application code. A `null` result is therefore ambiguous on purpose — it means
 * either the group does not exist in this tenant, or the write's precondition did not hold — and the
 * service distinguishes the two with a follow-up `findById` only when it actually needs to.
 *
 * Exports: `create`, `findById`, `findByNameLower`, `list`, `update`, `remove`, `addMember`,
 * `removeMember`, `isMember`.
 */
import mongoose from 'mongoose';
import { UserGroup } from '../models/UserGroup.js';

/**
 * Cast a user id to a real `ObjectId` instance before it goes into a `memberIds` filter or update.
 *
 * Mongoose's own query casting does not resolve a bare string correctly when the operand sits inside
 * an operator object compared against an array-of-`ObjectId` path (`{ memberIds: { $ne: userId } }`
 * raises a `CastError` trying to cast the whole `{ $ne: ... }` object, rather than casting `userId`
 * against the array's element type). Casting here, once, sidesteps that entirely: Mongoose never needs
 * to cast anything, because the value already is the right type.
 * @param {string} userId
 * @returns {import('mongoose').Types.ObjectId}
 */
const toObjectId = (userId) => new mongoose.Types.ObjectId(String(userId));

/**
 * Create a group. `nameLower` is supplied by the caller (the service derives it from `name`), not
 * computed here, so there is exactly one place in the codebase that decides how a name is normalised.
 * @param {string} orgId
 * @param {{ name: string, nameLower: string, description?: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create(orgId, { name, nameLower, description = '' }, { session } = {}) {
  const [doc] = await UserGroup.create([{ orgId, name, nameLower, description }], { session });
  return doc;
}

/**
 * Fetch one group by id, scoped to the tenant.
 * @param {string} orgId
 * @param {string} groupId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findById(orgId, groupId, { session } = {}) {
  return UserGroup.findOne({ _id: groupId, orgId }).session(session ?? null);
}

/**
 * Fetch one group by its normalised name, scoped to the tenant — the AT-4 duplicate-name check.
 * @param {string} orgId
 * @param {string} nameLower already-lowercased
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findByNameLower(orgId, nameLower, { session } = {}) {
  return UserGroup.findOne({ orgId, nameLower }).session(session ?? null);
}

/**
 * List the organisation's groups, oldest first, paginated — the same ordering idiom as
 * `userRepo.list()`: `createdAt` first, `_id` as the tiebreak so pages stay stable when two groups
 * are created in the same millisecond.
 * @param {string} orgId
 * @param {{ page?: number, limit?: number }} [options]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function list(orgId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    UserGroup.find({ orgId }).sort({ createdAt: 1, _id: 1 }).skip(skip).limit(limit),
    UserGroup.countDocuments({ orgId }),
  ]);
  return { items, total, page, limit };
}

/**
 * Apply a patch (name/nameLower/description) to a group and return the updated document.
 * `runValidators` keeps the length limits enforced on this path, not only on create.
 * @param {string} orgId
 * @param {string} groupId
 * @param {{ name?: string, nameLower?: string, description?: string }} patch
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function update(orgId, groupId, patch, { session } = {}) {
  return UserGroup.findOneAndUpdate(
    { _id: groupId, orgId },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  );
}

/**
 * Delete a group outright. There is no soft delete here, unlike `Asset.retiredAt`: a group has no
 * outstanding commitments of its own (no request or loan points at a group, only at an asset and a
 * unit), so nothing downstream needs it to keep existing as a historical record. What stays, as ever,
 * is the audit trail describing that it existed and was removed.
 * @param {string} orgId
 * @param {string} groupId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>} the deleted document, for its audit snapshot
 */
export async function remove(orgId, groupId, { session } = {}) {
  return UserGroup.findOneAndDelete({ _id: groupId, orgId }, { session });
}

/**
 * Add one member, atomically and idempotently.
 *
 * The filter's `memberIds: { $ne: userId }` is the whole mechanism: the write only matches, and only
 * then applies `$addToSet`, when the user is not already in the array. A `null` result means either
 * "no such group in this tenant" or "already a member" — the service tells the two apart with
 * `findById` only in that branch, so the common case (a genuinely new member) costs one query.
 *
 * `$ne` is wrapped in `mongoose.trusted()` because `sanitizeFilter` is on globally and would otherwise
 * neutralise it — it cannot tell this operator, which the server built, from one smuggled in through
 * untrusted input — the same reason `refreshToken.repository.js`'s `$gt` checks and `findByIds`'s `$in`
 * are wrapped the same way.
 * @param {string} orgId
 * @param {string} groupId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function addMember(orgId, groupId, userId, { session } = {}) {
  const id = toObjectId(userId);
  return UserGroup.findOneAndUpdate(
    { _id: groupId, orgId, memberIds: mongoose.trusted({ $ne: id }) },
    { $addToSet: { memberIds: id } },
    { returnDocument: 'after', session },
  );
}

/**
 * Remove one member, atomically — the mirror image of `addMember`. `null` means either "no such
 * group" or "was not a member"; see `addMember`'s doc for why that ambiguity is deliberate.
 * @param {string} orgId
 * @param {string} groupId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function removeMember(orgId, groupId, userId, { session } = {}) {
  const id = toObjectId(userId);
  return UserGroup.findOneAndUpdate(
    { _id: groupId, orgId, memberIds: id },
    { $pull: { memberIds: id } },
    { returnDocument: 'after', session },
  );
}

/**
 * Is `userId` a member of this group, scoped to the tenant?
 *
 * An existence check rather than a full fetch, for the high-frequency caller this is really for: the
 * restricted-equipment eligibility check (SCRUM-149), which runs inside `checkout.service.js`'s
 * `submit()` transaction and needs only a boolean, not the group's name or its whole member list. The
 * optional `session` lets it read against that same transaction rather than a separate snapshot.
 * @param {string} orgId
 * @param {string} groupId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<boolean>}
 */
export async function isMember(orgId, groupId, userId, { session } = {}) {
  return Boolean(
    await UserGroup.exists({ _id: groupId, orgId, memberIds: toObjectId(userId) }).session(
      session ?? null,
    ),
  );
}

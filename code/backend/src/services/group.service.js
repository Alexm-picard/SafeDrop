// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: group CRUD, atomic membership changes, and the active-membership eligibility helper the restricted-equipment story will call (SCRUM-149)
// Human Contributions: pending review
// Notes: Written from the ticket's acceptance criteria (AT-1..AT-4) and design notes, including both answered open questions (groups-only scope; deactivated members excluded automatically at eligibility checks, not removed from the group). Must be reviewed and tested by the owning team member before merge.

/**
 * Named groups of members within one organisation (SCRUM-149).
 *
 * A group answers "which equipment may you borrow", kept deliberately separate from the role in
 * `utils/permissions.js`, which answers "what can you do in the app" — see `models/UserGroup.js` for
 * the full reasoning. This file is the whole lifecycle: create, read, rename, delete, and add/remove
 * one member at a time, plus `isActiveMember()`, the eligibility primitive a future restricted-equipment
 * feature will call on every request for a gated item.
 *
 * Every write follows the same shape `asset.service.js` established: resolve by `(orgId, id)` → 404 if
 * absent → change the state and append its audit event inside one `withTransaction()`. Unlike
 * `organization.service.js`'s `users:manage` operations, nothing here re-reads the actor's role from
 * the database — that extra step exists there specifically because a role change can revoke the very
 * authority the caller is acting with (a just-demoted admin promoting themselves back). Changing who is
 * in a group carries no such self-referential risk, so the ordinary `authorize(groups:manage)` check
 * the route already ran is enough, matching how `assets:write` operations are written.
 *
 * **Membership changes are each one atomic, conditional database write**, not a read-then-write: see
 * `group.repository.js`'s `addMember`/`removeMember` for why. **Group names are unique per organisation,
 * in any letter case** (AT-4): `nameLower` is derived here, in exactly one place, and the unique index
 * in migrations/ is the real backstop against two concurrent creates racing to the same name.
 *
 * Exports: `createGroup`, `getGroup`, `listGroups`, `updateGroup`, `deleteGroup`, `addGroupMember`,
 * `removeGroupMember`, `isActiveMember`.
 */
import { withTransaction } from '../config/db.js';
import * as groupRepo from '../repositories/group.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../utils/constants.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { record as recordAudit } from './audit.service.js';
import { publicUser } from './auth.service.js';

/** Error message for a group name already in use within the organisation (AT-4). */
const DUPLICATE_NAME = 'A group with this name already exists in your organisation';

/**
 * Is this the duplicate-key error MongoDB raises against a unique index? (Same helper as
 * `asset.service.js`'s; small enough that sharing it would cost more than it saves.)
 * @param {unknown} err
 * @returns {boolean}
 */
const isDuplicateKey = (err) => Boolean(err) && err.code === 11000;

/**
 * Project a group document to its public shape, without resolving member details.
 *
 * Used for list rows, where fetching and shaping every member of every group on the page would be
 * wasted work the caller did not ask for. `memberIds` stays as an array of id strings — a client that
 * needs names already has `getGroup()` for that.
 * @param {import('mongoose').Document} group
 * @returns {{ id: string, orgId: string, name: string, description: string, memberIds: string[], memberCount: number, createdAt: Date, updatedAt: Date }}
 */
function publicGroup(group) {
  const memberIds = group.memberIds.map(String);
  return {
    id: String(group._id),
    orgId: String(group.orgId),
    name: group.name,
    description: group.description,
    memberIds,
    memberCount: memberIds.length,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

/**
 * Create a group (`POST /api/groups`, AT-1).
 *
 * The name is checked for a duplicate *before* any write, as a courtesy that turns the common case
 * into a clean 409 without touching the database — the unique index in migrations/ is what actually
 * guarantees uniqueness against two admins racing to create the same name at once, caught below by the
 * duplicate-key handler.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string, role: string }} actor the verified caller (`req.auth`)
 * @param {{ name: string, description?: string }} input validated by the route's `groupBody`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ group: object }>}
 * @throws {ConflictError} (409) when the name is already used in this organisation (AT-4)
 */
export async function createGroup(orgId, actor, { name, description = '' }, { requestId } = {}) {
  const nameLower = name.trim().toLowerCase();
  if (await groupRepo.findByNameLower(orgId, nameLower)) {
    throw new ConflictError(DUPLICATE_NAME, { field: 'name' });
  }
  try {
    const group = await withTransaction(async (session) => {
      const created = await groupRepo.create(orgId, { name, nameLower, description }, { session });
      await recordAudit(
        orgId,
        {
          actor: { userId: actor.userId, role: actor.role },
          action: AUDIT_ACTION.GROUP_CREATED,
          targetType: AUDIT_TARGET_TYPE.UserGroup,
          targetId: created._id,
          before: null,
          after: { name: created.name, description: created.description },
          requestId,
        },
        { session },
      );
      return created;
    });
    return { group: publicGroup(group) };
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new ConflictError(DUPLICATE_NAME, { field: 'name' });
    }
    throw err;
  }
}

/**
 * Read one group with its members resolved (`GET /api/groups/:id`, AT-1's "the group lists both
 * members").
 *
 * Members are projected through the same `publicUser()` every other endpoint uses, so a deactivated
 * member shows `deactivatedAt` here exactly as it would in `GET /api/users` — visible to the admin
 * managing the group, per the ticket's answer to its own second open question: deactivation is not
 * mirrored into the group's stored membership (nothing here removes or hides a deactivated member),
 * only enforced automatically where it matters, at the eligibility check (`isActiveMember`).
 * @param {string} orgId the caller's organisation, from the token
 * @param {string} groupId
 * @returns {Promise<{ group: object }>}
 * @throws {NotFoundError} (404) when the group is not in the caller's organisation
 */
export async function getGroup(orgId, groupId) {
  const group = await groupRepo.findById(orgId, groupId);
  if (!group) {
    throw new NotFoundError('Group not found');
  }
  const members = await userRepo.findByIds(orgId, group.memberIds);
  // findByIds drops ids that no longer resolve to a user; order member rows the same way memberIds
  // lists them, rather than however the query happened to return them.
  const byId = new Map(members.map((user) => [String(user._id), publicUser(user)]));
  return {
    group: {
      ...publicGroup(group),
      members: group.memberIds.map((id) => byId.get(String(id))).filter(Boolean),
    },
  };
}

/**
 * List the organisation's groups, oldest first, paginated (`GET /api/groups`).
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ page?: number, limit?: number }} [query]
 * @returns {Promise<{ items: object[], total: number, page: number, limit: number }>}
 */
export async function listGroups(orgId, query = {}) {
  const { items, total, page, limit } = await groupRepo.list(orgId, query);
  return { items: items.map(publicGroup), total, page, limit };
}

/**
 * Rename and/or redescribe a group (`PATCH /api/groups/:id`).
 *
 * Only the keys actually present in `patch` are considered; a value equal to what is already stored
 * is dropped before anything is written, so setting a group to what it already is is a 200 no-op with
 * no audit event — the same rule `changeUserRole` follows for a role, for the same reason: an audit
 * trail full of non-events hides the real ones.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string, role: string }} actor the verified caller (`req.auth`)
 * @param {string} groupId
 * @param {{ name?: string, description?: string }} patch validated by the route's `groupPatch`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ group: object }>}
 * @throws {NotFoundError} (404) when the group is not in the caller's organisation
 * @throws {ConflictError} (409) when renaming to a name another group in this organisation already has
 */
export async function updateGroup(orgId, actor, groupId, patch, { requestId } = {}) {
  const group = await groupRepo.findById(orgId, groupId);
  if (!group) {
    throw new NotFoundError('Group not found');
  }

  const before = {};
  const after = {};
  const toSet = {};
  if (patch.name !== undefined && patch.name !== group.name) {
    const nameLower = patch.name.trim().toLowerCase();
    if (nameLower !== group.nameLower) {
      const clash = await groupRepo.findByNameLower(orgId, nameLower);
      if (clash && String(clash._id) !== String(group._id)) {
        throw new ConflictError(DUPLICATE_NAME, { field: 'name' });
      }
    }
    before.name = group.name;
    after.name = patch.name;
    toSet.name = patch.name;
    toSet.nameLower = nameLower;
  }
  if (patch.description !== undefined && patch.description !== group.description) {
    before.description = group.description;
    after.description = patch.description;
    toSet.description = patch.description;
  }

  if (Object.keys(toSet).length === 0) {
    return { group: publicGroup(group) };
  }

  try {
    const updated = await withTransaction(async (session) => {
      const saved = await groupRepo.update(orgId, groupId, toSet, { session });
      if (!saved) {
        // Deleted between the read above and this write — vanishingly rare, but a real possibility
        // now that deleteGroup exists.
        throw new NotFoundError('Group not found');
      }
      await recordAudit(
        orgId,
        {
          actor: { userId: actor.userId, role: actor.role },
          action: AUDIT_ACTION.GROUP_UPDATED,
          targetType: AUDIT_TARGET_TYPE.UserGroup,
          targetId: saved._id,
          before,
          after,
          requestId,
        },
        { session },
      );
      return saved;
    });
    return { group: publicGroup(updated) };
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new ConflictError(DUPLICATE_NAME, { field: 'name' });
    }
    throw err;
  }
}

/**
 * Delete a group (`DELETE /api/groups/:id`).
 *
 * A hard delete, unlike `Asset.retiredAt`'s soft delete: nothing else points at a group by id (a
 * request or loan points at a unit, never a group), so there is no record downstream that would be
 * left dangling. The audit event's `before` snapshot is what survives — name, description and exactly
 * who was a member at the moment of deletion.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string, role: string }} actor the verified caller (`req.auth`)
 * @param {string} groupId
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<void>}
 * @throws {NotFoundError} (404) when the group is not in the caller's organisation
 */
export async function deleteGroup(orgId, actor, groupId, { requestId } = {}) {
  await withTransaction(async (session) => {
    const group = await groupRepo.findById(orgId, groupId, { session });
    if (!group) {
      throw new NotFoundError('Group not found');
    }
    await groupRepo.remove(orgId, groupId, { session });
    await recordAudit(
      orgId,
      {
        actor: { userId: actor.userId, role: actor.role },
        action: AUDIT_ACTION.GROUP_DELETED,
        targetType: AUDIT_TARGET_TYPE.UserGroup,
        targetId: group._id,
        before: {
          name: group.name,
          description: group.description,
          memberIds: group.memberIds.map(String),
        },
        after: null,
        requestId,
      },
      { session },
    );
  });
}

/**
 * Add one member to a group (`POST /api/groups/:id/members`, AT-1, AT-2).
 *
 * The target user is looked up in the *caller's own* organisation before anything else: an id from
 * another tenant resolves to nothing and is reported as 404, never 403, so the response cannot be used
 * to confirm that the id exists somewhere else (AT-2, SR-2). The group is then re-read inside the
 * transaction — not reused from a check made before it — so the "already a member" decision below is
 * made against the same snapshot the write applies to.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string, role: string }} actor the verified caller (`req.auth`)
 * @param {string} groupId
 * @param {string} userId the member to add, validated by the route's `objectId`
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ group: object }>}
 * @throws {NotFoundError} (404) when the group or the user is not in the caller's organisation
 */
export async function addGroupMember(orgId, actor, groupId, userId, { requestId } = {}) {
  const target = await userRepo.findById(orgId, userId);
  if (!target) {
    throw new NotFoundError('User not found');
  }
  const group = await withTransaction(async (session) => {
    const existing = await groupRepo.findById(orgId, groupId, { session });
    if (!existing) {
      throw new NotFoundError('Group not found');
    }
    const updated = await groupRepo.addMember(orgId, groupId, userId, { session });
    if (!updated) {
      // addMember's filter only matches when the user is not already present, and the group's
      // existence was just confirmed in this same transaction — so null here means exactly one
      // thing: already a member. No-op, no audit, same rule as a role set to what it already is.
      return existing;
    }
    await recordAudit(
      orgId,
      {
        actor: { userId: actor.userId, role: actor.role },
        action: AUDIT_ACTION.GROUP_MEMBER_ADDED,
        targetType: AUDIT_TARGET_TYPE.UserGroup,
        targetId: updated._id,
        before: null,
        after: { userId: String(target._id), email: target.email, name: target.name },
        requestId,
      },
      { session },
    );
    return updated;
  });
  return { group: publicGroup(group) };
}

/**
 * Remove one member from a group (`DELETE /api/groups/:id/members/:userId`).
 *
 * Unlike `addGroupMember`, there is no separate lookup of the user: membership is defined entirely by
 * presence in `memberIds`, so removing an id that is not currently a member — whether it never was, or
 * belongs to an account that no longer exists — is a harmless no-op rather than a 404. Only the group
 * not existing in this tenant is a 404.
 * @param {string} orgId the caller's organisation, from the token
 * @param {{ userId: string, role: string }} actor the verified caller (`req.auth`)
 * @param {string} groupId
 * @param {string} userId the member to remove
 * @param {{ requestId?: string }} [context]
 * @returns {Promise<{ group: object }>}
 * @throws {NotFoundError} (404) when the group is not in the caller's organisation
 */
export async function removeGroupMember(orgId, actor, groupId, userId, { requestId } = {}) {
  const group = await withTransaction(async (session) => {
    const existing = await groupRepo.findById(orgId, groupId, { session });
    if (!existing) {
      throw new NotFoundError('Group not found');
    }
    const updated = await groupRepo.removeMember(orgId, groupId, userId, { session });
    if (!updated) {
      // Confirmed to exist above in this same transaction, so null here means the user was not a
      // member. No-op, no audit.
      return existing;
    }
    await recordAudit(
      orgId,
      {
        actor: { userId: actor.userId, role: actor.role },
        action: AUDIT_ACTION.GROUP_MEMBER_REMOVED,
        targetType: AUDIT_TARGET_TYPE.UserGroup,
        targetId: updated._id,
        before: { userId: String(userId) },
        after: null,
        requestId,
      },
      { session },
    );
    return updated;
  });
  return { group: publicGroup(group) };
}

/**
 * Is `userId` eligible through group membership right now? (The ticket's second open question.)
 *
 * The building block a future restricted-equipment feature calls to decide whether someone may request
 * a gated item. The answer to that question was: deactivated members are **not** removed from a group
 * — their row and history stay, which is what keeps `GROUP_MEMBER_ADDED`/`REMOVED` events meaningful
 * and matches how the rest of the product treats deactivation (nothing is deleted, see SCRUM-142) —
 * but they must **automatically** fail any eligibility check, because a deactivated member should never
 * be able to reach a checkout screen for anything, privileged or not. This function is where that rule
 * lives: it is not enough to be listed in `memberIds`, the membership must also be active right now.
 * The optional `session` lets a caller — `checkout.service.js`'s `submit()` — run this check inside
 * its own transaction, against the same snapshot the rest of that transaction sees, rather than a
 * separate read that could race a concurrent group or deactivation change.
 * @param {string} orgId the organisation both the group and the user belong to
 * @param {string} groupId
 * @param {string} userId
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<boolean>} true only when the group exists, contains this user, and the user is not deactivated
 */
export async function isActiveMember(orgId, groupId, userId, { session } = {}) {
  const [inGroup, user] = await Promise.all([
    groupRepo.isMember(orgId, groupId, userId, { session }),
    userRepo.findById(orgId, userId, { session }),
  ]);
  return inGroup && Boolean(user) && !user.deactivatedAt;
}

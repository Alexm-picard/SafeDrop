// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: UserGroup schema — named cohorts of members, the building block the restricted-equipment story will gate access on (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written from the ticket's design notes (model shape, nameLower for case-insensitive per-organisation uniqueness). Reviewed before merge; see Human Contributions.

/**
 * The `usergroups` collection: a named set of members within one organisation (SCRUM-149).
 *
 * Groups answer "which equipment may you borrow", which is deliberately kept separate from the role
 * in `utils/permissions.js`, which answers "what can you do in the app". A role is one of three fixed
 * values driving the whole authorization matrix; a group is an admin-defined, arbitrarily-named cohort
 * ("Certified Drone Pilots", "Film Dept Staff") that a future restricted-equipment feature will point
 * at to decide who may request a given item. Keeping the two apart means the permission matrix stays
 * small and reviewable, and a "privileged tier" becomes nothing more than a group an asset references.
 *
 * `name` keeps the admin's original casing for display; `nameLower` is a separate, always-lowercase
 * field the service computes whenever `name` is set, existing only so the database can enforce
 * "unique per organisation, in any letter case" (the ticket's AT-4) with an ordinary unique index —
 * this project uses no MongoDB collations elsewhere, so a normalised shadow field matches the house
 * idiom (compare `users.email`, normalised in place because its canonical form really is lowercase; a
 * group's display name is not, so it needs its own separate comparison key).
 *
 * `memberIds` is a plain array of `User` ids, not a join collection: group sizes are small (a cohort,
 * a department) and a group is always read or written as a whole, so no access pattern favours a join
 * collection over an embedded array. Membership is read from this array at request time — never
 * embedded in a JWT — so removing someone takes effect on their very next request, unlike a role
 * change, which waits for the access token to expire (SDD §6.2).
 */
import mongoose from 'mongoose';
import { createSchema, ObjectId, orgIdField } from './base.js';

const userGroupSchema = createSchema(
  {
    orgId: orgIdField,
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    // Derived from `name` by the service, never accepted from a request body directly. See the file
    // docblock for why this exists instead of normalising `name` itself.
    nameLower: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    memberIds: { type: [ObjectId], default: [] },
  },
  { collection: 'usergroups' },
);

// Guard against re-registration: Vitest re-evaluates this module per test file inside a reused worker.
export const UserGroup = mongoose.models.UserGroup ?? mongoose.model('UserGroup', userGroupSchema);

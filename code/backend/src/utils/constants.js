// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: domain enums shared by models, services, validation schemas (SDD §2.4); UserGroup target type and GROUP_* audit actions (SCRUM-149); MAX_ALLOWED_GROUPS (SCRUM-150)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18); reviewed and approved by Amber Rastella (PR #7, 2026-09-18); latest changes reviewed and approved by Alex Picard (PR #61, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the user-groups ticket.

/**
 * Domain enums and fixed limits shared across the backend (SDD §2.4).
 *
 * Models, services and the Zod request schemas all import their allowed values from here, so a
 * state name or audit action is spelled in exactly one place and a typo cannot let a model and its
 * validator disagree. Each enum is a frozen `{ VALUE: 'VALUE' }` map plus a frozen list of its keys:
 * the map is for referring to a single value in code, the list for Mongoose `enum` and `z.enum`.
 *
 * Adding a value here is a design change — update the SDD in the same commit.
 */
const freezeEnum = (values) => Object.freeze(Object.fromEntries(values.map((v) => [v, v])));

/**
 * Physical-unit lifecycle (SDD §2.4 AssetUnit.status).
 *
 * `MAINTENANCE` (SCRUM-141) is the reversible counterpart to `RETIRED`: a unit being repaired is out
 * of circulation but still owned, and comes back to `AVAILABLE` when it is fixed. Retiring is
 * permanent, so it is the wrong tool for a repair — and a retired unit cannot be un-retired.
 */
export const UNIT_STATUS = freezeEnum([
  'AVAILABLE',
  'HELD',
  'OUT',
  'RETIRED',
  'REQUESTED',
  'MAINTENANCE',
]);
export const UNIT_STATUS_LIST = Object.freeze(Object.keys(UNIT_STATUS));

/**
 * Checkout request state machine (SDD §2.4 CheckoutRequest.state, arch review F4).
 *
 * SCRUM-205 adds two states. `RETURN_PENDING`: the borrower says the item is back, and a different
 * Approver or Org Admin has not confirmed it yet. The unit stays OUT and the borrower stays
 * accountable until then. `EXPIRED`: an approval nobody collected within the pickup window, so the
 * held unit goes back to AVAILABLE.
 */
export const REQUEST_STATE = freezeEnum([
  'PENDING',
  'APPROVED',
  'DENIED',
  'CANCELLED',
  'CHECKED_OUT',
  'OVERDUE',
  'RETURN_PENDING',
  'RETURNED',
  'LOST',
  'EXPIRED',
]);
export const REQUEST_STATE_LIST = Object.freeze(Object.keys(REQUEST_STATE));

/** Every auditable action (SDD §2.5, SR-9). Adding one here is a design change: update the SDD. */
export const AUDIT_ACTION = freezeEnum([
  'REQUEST_SUBMITTED',
  'REQUEST_APPROVED',
  'REQUEST_DENIED',
  'REQUEST_CANCELLED',
  'ASSET_CHECKED_OUT',
  'ASSET_RETURNED',
  'ASSET_CREATED',
  'ASSET_UPDATED',
  'ASSET_RETIRED',
  'USER_ROLE_CHANGED',
  'USER_INVITED',
  // A completed password reset (SCRUM-22). The *request* for a link is not audited: it is
  // unauthenticated and anyone can trigger it for any address, so recording it would let a stranger
  // write rows into a tenant's audit log. Changing the password is the state change worth keeping.
  'USER_PASSWORD_RESET',
  'ORG_CREATED',
  // One physical unit leaving circulation for repair and coming back (SCRUM-141). Distinct actions
  // rather than one UNIT_STATUS_CHANGED, because the chain of custody is read as a story: "sent for
  // repair" and "back in service" are the two sentences a reader is looking for, and an action name
  // that needs its snapshot decoded to be understood is a worse row.
  'UNIT_MAINTENANCE_STARTED',
  'UNIT_MAINTENANCE_ENDED',
  // A request the approval policy granted without a human decision (SCRUM-148). Distinct from
  // REQUEST_APPROVED so the audit log never shows an approval with no approver behind it: a reader
  // can tell "Dana approved it" from "the rule approved it" by the action alone.
  'REQUEST_AUTO_APPROVED',
  // An Org Admin changed an organisation-wide setting (SCRUM-148: the approval default). Recorded with
  // before/after values, because a rule change explains every request decided differently after it.
  'ORG_SETTINGS_UPDATED',
  // User groups (SCRUM-149): named cohorts the restricted-equipment story will gate access on.
  // Membership changes get their own actions, distinct from GROUP_UPDATED (a rename or description
  // edit), so the trail reads as "who was added or removed" without decoding a memberIds diff.
  'GROUP_CREATED',
  'GROUP_UPDATED',
  'GROUP_DELETED',
  'GROUP_MEMBER_ADDED',
  'GROUP_MEMBER_REMOVED',
  // Custody confirmation (SCRUM-205). REQUEST_EXPIRED is written by the expiry sweep with the system
  // actor (no person decided it). RETURN_INITIATED is the borrower saying "it's back"; RETURN_REJECTED
  // is a confirmer saying it never arrived, with the reason. The confirmed return itself is still
  // ASSET_RETURNED, so "when did this unit come back" has one answer.
  'REQUEST_EXPIRED',
  'RETURN_INITIATED',
  'RETURN_REJECTED',
]);
export const AUDIT_ACTION_LIST = Object.freeze(Object.keys(AUDIT_ACTION));

/**
 * Does a checkout request need a human approver? (SCRUM-148)
 *
 * `REQUIRED` and `AUTO` are the two answers. `INHERIT` is only meaningful on an asset, where it means
 * "use the organisation default" — an organisation has nothing above it to inherit from, so its
 * default is restricted to `ORG_APPROVAL_MODE_LIST`.
 */
export const APPROVAL_MODE = freezeEnum(['INHERIT', 'REQUIRED', 'AUTO']);
export const APPROVAL_MODE_LIST = Object.freeze(Object.keys(APPROVAL_MODE));
export const ORG_APPROVAL_MODE_LIST = Object.freeze([APPROVAL_MODE.REQUIRED, APPROVAL_MODE.AUTO]);

/**
 * The role recorded on an audit event that no person caused (SCRUM-205): the expiry sweep. Such an
 * event has `actorId: null`. Not a user role: nobody can sign in as it or hold permissions with it.
 */
export const SYSTEM_ACTOR_ROLE = 'SYSTEM';

/**
 * How long an approved request may wait to be picked up, in hours after `neededFrom` (SCRUM-205).
 * After this the expiry sweep moves it to EXPIRED and frees the unit. 48 hours was the story's
 * answer to its own open question. The maximum (30 days) is a sanity bound for the settings form.
 */
export const DEFAULT_PICKUP_GRACE_HOURS = 48;
export const MAX_PICKUP_GRACE_HOURS = 720;

/**
 * The most groups one asset may be restricted to (SCRUM-150). Generous for real use — a narrow
 * certification plus a few broad ones — while keeping the eligibility query and the badge bounded.
 */
export const MAX_ALLOWED_GROUPS = 20;

export const AUDIT_TARGET_TYPE = freezeEnum([
  'Organization',
  'User',
  'Asset',
  'AssetUnit',
  'CheckoutRequest',
  'UserGroup',
]);
export const AUDIT_TARGET_TYPE_LIST = Object.freeze(Object.keys(AUDIT_TARGET_TYPE));

export const ASSET_CONDITION = freezeEnum(['NEW', 'GOOD', 'FAIR', 'POOR']);
export const ASSET_CONDITION_LIST = Object.freeze(Object.keys(ASSET_CONDITION));

/** bcrypt work factor (SR-3). bcrypt only hashes the first 72 bytes, so longer passwords are rejected. */
export const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

export const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
// 1–64 chars, alphanumeric at both ends. The middle is {0,62} so two-character slugs like "bu" match.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: domain enums shared by models, services, validation schemas (SDD §2.4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

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

/** Physical-unit lifecycle (SDD §2.4 AssetUnit.status). */
export const UNIT_STATUS = freezeEnum(['AVAILABLE', 'HELD', 'OUT', 'RETIRED', 'REQUESTED']);
export const UNIT_STATUS_LIST = Object.freeze(Object.keys(UNIT_STATUS));

/** Checkout request state machine (SDD §2.4 CheckoutRequest.state, arch review F4). */
export const REQUEST_STATE = freezeEnum([
  'PENDING',
  'APPROVED',
  'DENIED',
  'CANCELLED',
  'CHECKED_OUT',
  'OVERDUE',
  'RETURNED',
  'LOST',
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
]);
export const AUDIT_ACTION_LIST = Object.freeze(Object.keys(AUDIT_ACTION));

export const AUDIT_TARGET_TYPE = freezeEnum([
  'Organization',
  'User',
  'Asset',
  'AssetUnit',
  'CheckoutRequest',
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

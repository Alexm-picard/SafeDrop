// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: domain enums shared by models, services, validation schemas (SDD §2.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

const freezeEnum = (values) => Object.freeze(Object.fromEntries(values.map((v) => [v, v])));

/** Physical-unit lifecycle (SDD §2.4 AssetUnit.status). */
export const UNIT_STATUS = freezeEnum(['AVAILABLE', 'HELD', 'OUT', 'RETIRED']);
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
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

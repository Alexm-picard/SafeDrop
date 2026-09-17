// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: shared schema options (id/timestamps/JSON shape) and the tenant field definition
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import mongoose from 'mongoose';

export const { ObjectId } = mongoose.Schema.Types;

/**
 * Every tenant-owned collection carries this field. It is set by the server from the verified token
 * (services pass req.orgId into repositories) and can never change after creation.
 * Indexes are NOT declared on schemas: migrations/ is the single source of truth (autoIndex is off).
 */
export const orgIdField = Object.freeze({ type: ObjectId, required: true, immutable: true });

const jsonTransform = (_doc, ret) => {
  delete ret._id;
  delete ret.passwordHash;
  return ret;
};

/** `id` string instead of `_id`, no `__v`, ObjectIds flattened to strings, passwordHash never serialised. */
export const baseSchemaOptions = Object.freeze({
  timestamps: true,
  toJSON: { virtuals: true, versionKey: false, flattenObjectIds: true, transform: jsonTransform },
  toObject: { virtuals: true, versionKey: false, flattenObjectIds: true, transform: jsonTransform },
});

/**
 * @param {import('mongoose').SchemaDefinition} definition
 * @param {import('mongoose').SchemaOptions} [options]
 */
export function createSchema(definition, options = {}) {
  return new mongoose.Schema(definition, { ...baseSchemaOptions, ...options });
}

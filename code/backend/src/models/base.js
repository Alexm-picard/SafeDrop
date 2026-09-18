// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: shared schema options (id/timestamps/JSON shape) and the tenant field definition
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Shared building blocks for every Mongoose schema in the project.
 *
 * Collecting them here is what makes the models consistent in the ways that matter for security: the
 * same tenant field, the same JSON shape, and no index declarations. Indexes are deliberately absent
 * from the schemas — `migrations/` is their single source of truth and `autoIndex` is off, so an
 * index is never created implicitly by a process booting against production.
 *
 * Exports:
 *  - `ObjectId` — re-exported Mongoose ObjectId type, so models need not import mongoose for it.
 *  - `orgIdField` — the tenant field every tenant-owned collection carries.
 *  - `baseSchemaOptions` — timestamps plus the serialisation rules.
 *  - `createSchema(definition, options)` — build a schema with those options applied.
 */
import mongoose from 'mongoose';

export const { ObjectId } = mongoose.Schema.Types;

/**
 * Every tenant-owned collection carries this field. It is set by the server from the verified token
 * (services pass req.orgId into repositories) and can never change after creation.
 * Indexes are NOT declared on schemas: migrations/ is the single source of truth (autoIndex is off).
 */
export const orgIdField = Object.freeze({ type: ObjectId, required: true, immutable: true });

/**
 * Shape a document on its way out as JSON.
 *
 * `_id` is dropped in favour of the `id` virtual, and `passwordHash` is deleted unconditionally.
 * That second line is a backstop: the field is already `select: false` on the schema, so this only
 * matters if a repository explicitly asked for it (login does), and it means a hash can never reach
 * a response through a stray `res.json(user)`.
 * @param {import('mongoose').Document} _doc
 * @param {Record<string, unknown>} ret the plain object being returned
 * @returns {Record<string, unknown>}
 */
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
 * Build a Mongoose schema with the project-wide options applied.
 *
 * Every model goes through this rather than calling `new mongoose.Schema` directly, so the JSON
 * transform and timestamp behaviour cannot drift between collections. `options` is merged last, so
 * a model can override a single option (AuditEvent turns timestamps off and sets `strict: 'throw'`).
 * @param {import('mongoose').SchemaDefinition} definition field definitions
 * @param {import('mongoose').SchemaOptions} [options] per-model overrides merged over the defaults
 * @returns {import('mongoose').Schema}
 */
export function createSchema(definition, options = {}) {
  return new mongoose.Schema(definition, { ...baseSchemaOptions, ...options });
}

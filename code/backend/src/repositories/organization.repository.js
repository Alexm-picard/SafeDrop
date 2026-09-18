// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Organization persistence (the tenant itself, so no orgId scoping parameter)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Data access for the `organizations` collection.
 *
 * The odd one out among the repositories: an organisation *is* the tenant, so these functions take an
 * organisation id or slug rather than being scoped by one.
 *
 * Exports: `create`, `findById`, `findBySlug`.
 */
import { Organization } from '../models/Organization.js';

/**
 * Insert a new organisation.
 *
 * Slug uniqueness is enforced by the index from migrations/, not checked here, so a collision
 * surfaces as a duplicate-key error for the service to translate into a 409.
 * @param {{ name: string, slug: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document>}
 */
export async function create({ name, slug }, { session } = {}) {
  const [doc] = await Organization.create([{ name, slug }], { session });
  return doc;
}

/**
 * Fetch an organisation by id.
 * @param {string} orgId the caller's own tenant id (from the verified token)
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findById(orgId) {
  return Organization.findById(orgId);
}

/**
 * Resolve a login slug to its organisation.
 *
 * Used only by login, which is a public route: this is the step that decides which tenant an email
 * and password will be checked against, before any user lookup happens. The slug is lowercased to
 * match how it is stored.
 * @param {string} slug
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findBySlug(slug, { session } = {}) {
  return Organization.findOne({ slug: String(slug).toLowerCase() }).session(session ?? null);
}

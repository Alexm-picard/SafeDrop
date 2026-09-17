// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Organization persistence (the tenant itself, so no orgId scoping parameter)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { Organization } from '../models/Organization.js';

/**
 * @param {{ name: string, slug: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 */
export async function create({ name, slug }, { session } = {}) {
  const [doc] = await Organization.create([{ name, slug }], { session });
  return doc;
}

/** @param {string} orgId the caller's own tenant id (from the verified token) */
export async function findById(orgId) {
  return Organization.findById(orgId);
}

/** Used only by login to resolve which tenant an email belongs to. */
export async function findBySlug(slug, { session } = {}) {
  return Organization.findOne({ slug: String(slug).toLowerCase() }).session(session ?? null);
}

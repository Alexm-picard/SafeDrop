// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: tenant-scoped user persistence; passwordHash only via the explicit *WithPassword reader (SR-2, SR-3)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// Every function takes orgId first. A document from another tenant is simply never matched, so the
// service layer turns `null` into a 404 (never a 403, which would confirm the id exists).

import { User } from '../models/User.js';

const normalizeEmail = (email) => String(email).trim().toLowerCase();

/**
 * @param {string} orgId
 * @param {{ email: string, name: string, role: string, passwordHash: string }} data
 * @param {{ session?: import('mongoose').ClientSession }} [options]
 */
export async function create(orgId, { email, name, role, passwordHash }, { session } = {}) {
  const [doc] = await User.create(
    [{ orgId, email: normalizeEmail(email), name, role, passwordHash }],
    {
      session,
    },
  );
  return doc;
}

export async function findById(orgId, userId) {
  return User.findOne({ _id: userId, orgId });
}

export async function findByEmail(orgId, email) {
  return User.findOne({ orgId, email: normalizeEmail(email) });
}

/** Login only: the sole reader that selects passwordHash. */
export async function findByEmailWithPassword(orgId, email) {
  return User.findOne({ orgId, email: normalizeEmail(email) }).select('+passwordHash');
}

/**
 * Current role straight from the database (not the token). Role changes take effect immediately for
 * sensitive operations such as users:manage (SDD §6.2).
 * @returns {Promise<string|null>}
 */
export async function findRole(orgId, userId) {
  const doc = await User.findOne({ _id: userId, orgId }).select('role').lean();
  return doc ? doc.role : null;
}

export async function updateRole(orgId, userId, role, { session } = {}) {
  return User.findOneAndUpdate(
    { _id: userId, orgId },
    { $set: { role } },
    { returnDocument: 'after', runValidators: true, session },
  );
}

export async function list(orgId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.find({ orgId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
    User.countDocuments({ orgId }),
  ]);
  return { items, total, page, limit };
}

export async function countByOrg(orgId) {
  return User.countDocuments({ orgId });
}

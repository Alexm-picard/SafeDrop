// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: two fully populated tenants for isolation tests (SR-2)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The standard test fixture: two fully populated organisations.
 *
 * Two, not one, and that is the point. Tenant isolation (SR-2) can only be tested against a second
 * organisation that also has data — with a single tenant, a query missing its `orgId` filter would
 * pass every test. Every isolation test here asks whether org A can see or touch org B.
 *
 * Each organisation gets one user per role, one asset with three units in different statuses, a
 * pending checkout request and an audit event, so a test can exercise any layer without seeding more.
 */
import bcrypt from 'bcryptjs';
import * as assetRepo from '../../src/repositories/asset.repository.js';
import * as assetUnitRepo from '../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../src/repositories/auditEvent.repository.js';
import * as checkoutRepo from '../../src/repositories/checkoutRequest.repository.js';
import * as orgRepo from '../../src/repositories/organization.repository.js';
import * as userRepo from '../../src/repositories/user.repository.js';
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
  BCRYPT_COST,
  UNIT_STATUS,
} from '../../src/utils/constants.js';
import { ROLES } from '../../src/utils/permissions.js';

/**
 * The password every seeded user shares.
 */
export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

let hashPromise;
/**
 * Hash the shared test password, once per test file.
 *
 * At the *real* bcrypt cost, so login tests exercise the production work factor rather than a
 * weakened one. That is deliberately expensive — hence the memoised promise, which pays the cost once
 * instead of once per seeded user.
 * @returns {Promise<string>}
 */
export function testPasswordHash() {
  hashPromise ??= bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
  return hashPromise;
}

/**
 * Seed one organisation with its users, asset, units, request and audit event.
 *
 * Names and emails are derived from `key` (`org-a`, `admin@a.test`), so the two organisations are
 * told apart at a glance in a failing assertion. The users are created concurrently since they are
 * independent inserts.
 * @param {string} key short identifier, 'a' or 'b'
 * @returns {Promise<object>} the organisation and everything seeded in it
 */
async function seedOrg(key) {
  const passwordHash = await testPasswordHash();
  const org = await orgRepo.create({ name: `Org ${key.toUpperCase()}`, slug: `org-${key}` });
  const orgId = org._id;
  const [admin, approver, member] = await Promise.all([
    userRepo.create(orgId, {
      email: `admin@${key}.test`,
      name: `Admin ${key}`,
      role: ROLES.ORG_ADMIN,
      passwordHash,
    }),
    userRepo.create(orgId, {
      email: `approver@${key}.test`,
      name: `Approver ${key}`,
      role: ROLES.APPROVER,
      passwordHash,
    }),
    userRepo.create(orgId, {
      email: `member@${key}.test`,
      name: `Member ${key}`,
      role: ROLES.MEMBER,
      passwordHash,
    }),
  ]);
  const asset = await assetRepo.create(orgId, {
    name: `Laptop ${key}`,
    category: 'laptop',
    description: '',
    imageUrl: null,
  });
  const units = [
    await assetUnitRepo.create(orgId, {
      assetId: asset._id,
      tag: `${key}-001`,
      status: UNIT_STATUS.AVAILABLE,
    }),
    await assetUnitRepo.create(orgId, {
      assetId: asset._id,
      tag: `${key}-002`,
      status: UNIT_STATUS.OUT,
    }),
    await assetUnitRepo.create(orgId, {
      assetId: asset._id,
      tag: `${key}-003`,
      status: UNIT_STATUS.HELD,
    }),
  ];
  const request = await checkoutRepo.create(orgId, {
    unitId: units[0]._id,
    requesterId: member._id,
    neededFrom: new Date('2026-10-01T00:00:00Z'),
    neededTo: new Date('2026-10-15T00:00:00Z'),
    note: '',
  });
  const audit = await auditRepo.append(orgId, {
    actorId: admin._id,
    actorRole: ROLES.ORG_ADMIN,
    action: AUDIT_ACTION.ORG_CREATED,
    targetType: AUDIT_TARGET_TYPE.Organization,
    targetId: orgId,
    after: { name: org.name },
  });
  return { org, orgId: String(orgId), admin, approver, member, asset, units, request, audit };
}

/**
 * Seed both organisations and return them as `{ a, b, password }`.
 *
 * Org A is conventionally the caller and org B the one that must remain invisible to it.
 * @returns {Promise<{ a: object, b: object, password: string }>}
 */
export async function seedTwoOrgs() {
  const a = await seedOrg('a');
  const b = await seedOrg('b');
  return { a, b, password: TEST_PASSWORD };
}

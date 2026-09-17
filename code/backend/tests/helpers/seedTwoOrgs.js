// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: two fully populated tenants for isolation tests (SR-2)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

let hashPromise;
/** Hashed once per test file at the real cost so login tests exercise the production work factor. */
export function testPasswordHash() {
  hashPromise ??= bcrypt.hash(TEST_PASSWORD, BCRYPT_COST);
  return hashPromise;
}

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
 * Two organisations, each with an ORG_ADMIN, APPROVER and MEMBER (all with TEST_PASSWORD), one asset
 * with three units (AVAILABLE, OUT, HELD), one pending checkout request and one audit event.
 */
export async function seedTwoOrgs() {
  const a = await seedOrg('a');
  const b = await seedOrg('b');
  return { a, b, password: TEST_PASSWORD };
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: two fully populated tenants for isolation tests (SR-2) and for `npm run seed`
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * The standard test fixture: two fully populated organisations.
 *
 * Two, not one, and that is the point. Tenant isolation (SR-2) can only be tested against a second
 * organisation that also has data — with a single tenant, a query missing its `orgId` filter would
 * pass every test. Every isolation test here asks whether org A can see or touch org B.
 *
 * Each organisation gets one user per role, three assets with units across every status (incl.
 * retired), and a request behind every unit whose status a request produces (HELD, OUT, RETIRED) so
 * the fixture reflects a state the app's own checkout flow could actually reach. This same function
 * backs `npm run seed` (see scripts/seedDev.js) — it is the one place "seed two organisations" is
 * implemented.
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
 * Seed one organisation with its users, assets, units, requests and audit event.
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
      status: UNIT_STATUS.REQUESTED,
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

  const camera = await assetRepo.create(orgId, {
    name: `Camera ${key.toUpperCase()}`,
    category: 'camera',
    description: '',
    imageUrl: null,
  });
  const cameraUnits = [
    await assetUnitRepo.create(orgId, {
      assetId: camera._id,
      tag: `${key}-c01`,
      status: UNIT_STATUS.AVAILABLE,
    }),
    await assetUnitRepo.create(orgId, {
      assetId: camera._id,
      tag: `${key}-c02`,
      status: UNIT_STATUS.AVAILABLE,
    }),
    await assetUnitRepo.create(orgId, {
      assetId: camera._id,
      tag: `${key}-c03`,
      status: UNIT_STATUS.RETIRED,
    }),
  ];

  const projector = await assetRepo.create(orgId, {
    name: `Projector ${key.toUpperCase()}`,
    category: 'projector',
    description: '',
    imageUrl: null,
  });
  const projectorUnits = [
    await assetUnitRepo.create(orgId, {
      assetId: projector._id,
      tag: `${key}-p01`,
      status: UNIT_STATUS.AVAILABLE,
    }),
    await assetUnitRepo.create(orgId, {
      assetId: projector._id,
      tag: `${key}-p02`,
      status: UNIT_STATUS.OUT,
    }),
  ];

  const extraAssets = [
    { asset: camera, units: cameraUnits },
    { asset: projector, units: projectorUnits },
  ];

  let heldRequest = await checkoutRepo.create(orgId, {
    unitId: units[2]._id,
    requesterId: member._id,
    neededFrom: new Date('2026-09-25T00:00:00Z'),
    neededTo: new Date('2026-10-05T00:00:00Z'),
    note: '',
  });
  heldRequest = await checkoutRepo.transition(orgId, heldRequest._id, {
    expectedState: 'PENDING',
    patch: {
      state: 'APPROVED',
      decidedBy: approver._id,
      decidedAt: new Date('2026-09-20T00:00:00Z'),
      decisionNote: '',
    },
  });

  let checkedOutRequest = await checkoutRepo.create(orgId, {
    unitId: units[1]._id,
    requesterId: member._id,
    neededFrom: new Date('2026-09-10T00:00:00Z'),
    neededTo: new Date('2026-09-24T00:00:00Z'),
    note: '',
  });
  checkedOutRequest = await checkoutRepo.transition(orgId, checkedOutRequest._id, {
    expectedState: 'PENDING',
    patch: {
      state: 'APPROVED',
      decidedBy: approver._id,
      decidedAt: new Date('2026-09-09T00:00:00Z'),
      decisionNote: '',
    },
  });
  checkedOutRequest = await checkoutRepo.transition(orgId, checkedOutRequest._id, {
    expectedState: 'APPROVED',
    patch: {
      state: 'CHECKED_OUT',
      checkedOutAt: new Date('2026-09-10T00:00:00Z'),
      dueAt: new Date('2026-09-24T00:00:00Z'),
    },
  });

  let projectorRequest = await checkoutRepo.create(orgId, {
    unitId: projectorUnits[1]._id,
    requesterId: member._id,
    neededFrom: new Date('2026-09-12T00:00:00Z'),
    neededTo: new Date('2026-09-26T00:00:00Z'),
    note: '',
  });
  projectorRequest = await checkoutRepo.transition(orgId, projectorRequest._id, {
    expectedState: 'PENDING',
    patch: {
      state: 'APPROVED',
      decidedBy: approver._id,
      decidedAt: new Date('2026-09-11T00:00:00Z'),
      decisionNote: '',
    },
  });
  projectorRequest = await checkoutRepo.transition(orgId, projectorRequest._id, {
    expectedState: 'APPROVED',
    patch: {
      state: 'CHECKED_OUT',
      checkedOutAt: new Date('2026-09-12T00:00:00Z'),
      dueAt: new Date('2026-09-26T00:00:00Z'),
    },
  });

  let lostRequest = await checkoutRepo.create(orgId, {
    unitId: cameraUnits[2]._id,
    requesterId: member._id,
    neededFrom: new Date('2026-08-01T00:00:00Z'),
    neededTo: new Date('2026-08-15T00:00:00Z'),
    note: '',
  });
  lostRequest = await checkoutRepo.transition(orgId, lostRequest._id, {
    expectedState: 'PENDING',
    patch: {
      state: 'APPROVED',
      decidedBy: approver._id,
      decidedAt: new Date('2026-07-30T00:00:00Z'),
      decisionNote: '',
    },
  });
  lostRequest = await checkoutRepo.transition(orgId, lostRequest._id, {
    expectedState: 'APPROVED',
    patch: {
      state: 'CHECKED_OUT',
      checkedOutAt: new Date('2026-08-01T00:00:00Z'),
      dueAt: new Date('2026-08-15T00:00:00Z'),
    },
  });
  lostRequest = await checkoutRepo.transition(orgId, lostRequest._id, {
    expectedState: 'CHECKED_OUT',
    patch: { state: 'LOST' },
  });

  return {
    org,
    orgId: String(orgId),
    admin,
    approver,
    member,
    asset,
    units,
    request,
    audit,
    extraAssets,
    heldRequest,
    checkedOutRequest,
    projectorRequest,
    lostRequest,
  };
}

/**
 * Append a realistic chain of custody over one organisation's laptop, for the demo (SCRUM-39).
 *
 * **Deliberately not part of `seedOrg`.** The fixture is shared by every integration test, and several
 * of them count audit events; folding these rows in would change those totals and couple unrelated
 * suites to this demo data. `scripts/seedDev.js` calls it, the tests do not — a test that wants a
 * history builds exactly the events it asserts on.
 *
 * Every row matches a state the fixture actually left behind, so the trail and the data agree: the
 * OUT unit has a submission, an approval and a checkout; the HELD unit has a submission and an
 * approval; the REQUESTED unit has a submission and nothing more. Inventing a return for a unit that
 * is still checked out would make the demo screen tell a story the database contradicts.
 *
 * The events land a moment apart rather than days apart, because `AuditEvent` re-stamps `timestamp`
 * on every insert path (SR-8) — not even a seed script can place a row in the past. The order is
 * still exact: appends are awaited in sequence, and the read sorts on `_id` where timestamps tie.
 * @param {object} org one half of the `seedTwoOrgs` result
 * @returns {Promise<object[]>} the appended events, oldest first
 */
export async function seedAssetHistory(org) {
  const { orgId, admin, approver, member, asset, units } = org;
  const timeline = [
    {
      actor: admin,
      action: AUDIT_ACTION.ASSET_CREATED,
      type: AUDIT_TARGET_TYPE.Asset,
      id: asset._id,
    },
    {
      actor: admin,
      action: AUDIT_ACTION.ASSET_UPDATED,
      type: AUDIT_TARGET_TYPE.AssetUnit,
      id: units[1]._id,
    },
    {
      actor: member,
      action: AUDIT_ACTION.REQUEST_SUBMITTED,
      type: AUDIT_TARGET_TYPE.CheckoutRequest,
      id: org.checkedOutRequest._id,
    },
    {
      actor: approver,
      action: AUDIT_ACTION.REQUEST_APPROVED,
      type: AUDIT_TARGET_TYPE.CheckoutRequest,
      id: org.checkedOutRequest._id,
    },
    {
      actor: approver,
      action: AUDIT_ACTION.ASSET_CHECKED_OUT,
      type: AUDIT_TARGET_TYPE.AssetUnit,
      id: units[1]._id,
    },
    {
      actor: member,
      action: AUDIT_ACTION.REQUEST_SUBMITTED,
      type: AUDIT_TARGET_TYPE.CheckoutRequest,
      id: org.heldRequest._id,
    },
    {
      actor: approver,
      action: AUDIT_ACTION.REQUEST_APPROVED,
      type: AUDIT_TARGET_TYPE.CheckoutRequest,
      id: org.heldRequest._id,
    },
    {
      actor: member,
      action: AUDIT_ACTION.REQUEST_SUBMITTED,
      type: AUDIT_TARGET_TYPE.CheckoutRequest,
      id: org.request._id,
    },
    {
      actor: admin,
      action: AUDIT_ACTION.ASSET_UPDATED,
      type: AUDIT_TARGET_TYPE.Asset,
      id: asset._id,
    },
  ];
  const appended = [];
  for (const entry of timeline) {
    // Sequential, not `Promise.all`: the order these are written in is the order the history reads
    // back in, and a parallel append would leave it to chance.
    appended.push(
      await auditRepo.append(orgId, {
        actorId: entry.actor._id,
        actorRole: entry.actor.role,
        action: entry.action,
        targetType: entry.type,
        targetId: entry.id,
      }),
    );
  }
  return appended;
}

/**
 * Seed both organisations and return them as `{ a, b, password }`.
 *
 * Org A is conventionally the caller and org B the one that must remain invisible to it. The
 * returned objects carry every created document (ids included), so a caller — a test or
 * `scripts/seedDev.js` — has everything it needs without a second database read.
 * @returns {Promise<{ a: object, b: object, password: string }>}
 */
export async function seedTwoOrgs() {
  const a = await seedOrg('a');
  const b = await seedOrg('b');
  return { a, b, password: TEST_PASSWORD };
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: every index from SDD §2.4 data model; tenant compound indexes begin with orgId (NFR-4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// First migration: creates every index the models rely on. Mongoose autoIndex is OFF (src/server.js),
// so this file is the single source of truth for indexes. tests/setup.js also applies it to the
// in-memory database so unique constraints behave identically in tests.

/**
 * @param {import('mongodb').Db} db
 */
export const up = async (db) => {
  await db
    .collection('organizations')
    .createIndexes([{ key: { slug: 1 }, name: 'slug_unique', unique: true }]);

  await db.collection('users').createIndexes([
    // OD-3 default: email unique per organization (one user belongs to one org).
    { key: { orgId: 1, email: 1 }, name: 'orgId_email_unique', unique: true },
    { key: { orgId: 1, role: 1 }, name: 'orgId_role' },
  ]);

  await db.collection('refreshtokens').createIndexes([
    { key: { tokenHash: 1 }, name: 'tokenHash_unique', unique: true },
    { key: { orgId: 1, userId: 1 }, name: 'orgId_userId' },
    { key: { orgId: 1, familyId: 1 }, name: 'orgId_familyId' },
    { key: { expiresAt: 1 }, name: 'expiresAt' },
    // TTL on the ABSOLUTE expiry: rotated ancestors stay queryable for the family's whole life, so
    // reuse of a stolen ancestor is detected until the family itself is dead (max 12h retention).
    { key: { absoluteExpiresAt: 1 }, name: 'absoluteExpiresAt_ttl', expireAfterSeconds: 0 },
  ]);

  await db.collection('assets').createIndexes([
    { key: { orgId: 1, name: 1 }, name: 'orgId_name' },
    { key: { orgId: 1, category: 1 }, name: 'orgId_category' },
    { key: { orgId: 1, retiredAt: 1 }, name: 'orgId_retiredAt' },
  ]);

  await db.collection('assetunits').createIndexes([
    { key: { orgId: 1, tag: 1 }, name: 'orgId_tag_unique', unique: true },
    { key: { orgId: 1, assetId: 1 }, name: 'orgId_assetId' },
    { key: { orgId: 1, status: 1 }, name: 'orgId_status' },
  ]);

  await db.collection('checkoutrequests').createIndexes([
    { key: { orgId: 1, state: 1, dueAt: 1 }, name: 'orgId_state_dueAt' },
    { key: { orgId: 1, requesterId: 1, createdAt: -1 }, name: 'orgId_requesterId_createdAt' },
    { key: { orgId: 1, unitId: 1, state: 1 }, name: 'orgId_unitId_state' },
  ]);

  await db.collection('auditevents').createIndexes([
    { key: { orgId: 1, timestamp: -1 }, name: 'orgId_timestamp' },
    {
      key: { orgId: 1, targetType: 1, targetId: 1, timestamp: -1 },
      name: 'orgId_target_timestamp',
    },
    { key: { orgId: 1, actorId: 1, timestamp: -1 }, name: 'orgId_actorId_timestamp' },
  ]);
};

/**
 * @param {import('mongodb').Db} db
 */
export const down = async (db) => {
  const drop = async (collection, names) => {
    for (const name of names) {
      try {
        await db.collection(collection).dropIndex(name);
      } catch (_err) {
        // index (or collection) already gone
      }
    }
  };
  await drop('organizations', ['slug_unique']);
  await drop('users', ['orgId_email_unique', 'orgId_role']);
  await drop('refreshtokens', [
    'tokenHash_unique',
    'orgId_userId',
    'orgId_familyId',
    'expiresAt',
    'absoluteExpiresAt_ttl',
  ]);
  await drop('assets', ['orgId_name', 'orgId_category', 'orgId_retiredAt']);
  await drop('assetunits', ['orgId_tag_unique', 'orgId_assetId', 'orgId_status']);
  await drop('checkoutrequests', [
    'orgId_state_dueAt',
    'orgId_requesterId_createdAt',
    'orgId_unitId_state',
  ]);
  await drop('auditevents', [
    'orgId_timestamp',
    'orgId_target_timestamp',
    'orgId_actorId_timestamp',
  ]);
};

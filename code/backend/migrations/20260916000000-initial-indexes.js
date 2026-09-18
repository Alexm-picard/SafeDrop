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
 * First migration: every index the data model relies on (SDD §2.4).
 *
 * Mongoose `autoIndex` is off, so this file is the single source of truth for indexes — nothing is
 * created implicitly by a process starting up. tests/setup.js applies it to the in-memory database
 * too, so unique constraints and TTL behave identically under test.
 *
 * Two conventions run through it. **Every tenant index begins with `orgId`** (NFR-4), because every
 * query is scoped by tenant first; an index that did not lead with it would not serve those queries.
 * And **every index is named explicitly**, so `down()` can drop exactly what `up()` created rather
 * than relying on generated names.
 */
/**
 * Create every index.
 *
 * Most are ordinary compound indexes supporting the queries each repository makes. Two are worth
 * singling out:
 *
 * `assetunits.orgId_tag_unique` is what makes an asset tag unique *within* an organisation while
 * allowing two organisations to use the same tag — the same pattern as `users.orgId_email_unique`
 * (OD-3).
 *
 * `refreshtokens.absoluteExpiresAt_ttl` puts the TTL on the *absolute* expiry rather than the idle
 * one. A rotated-away token must stay in the collection for the family's whole life, because that is
 * what makes reuse of a stolen ancestor detectable; expiring it on the idle timeout would delete the
 * evidence while the session was still alive. Retention is therefore bounded by the 12-hour absolute
 * session limit.
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
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
 * Drop every index this migration created.
 *
 * Each drop is individually tolerant of a missing index or collection: a rollback often runs against
 * a database where the migration only partly applied, and failing there would leave no way to roll
 * back at all.
 * @param {import('mongodb').Db} db
 * @returns {Promise<void>}
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

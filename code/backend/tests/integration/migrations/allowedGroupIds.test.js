// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-150 ticket)
// AI-Assisted Areas: tests for the requiredGroupId -> allowedGroupIds data migration
// Human Contributions: pending team review
// Notes: Follows the migration tests in tests/integration/routes/approvalSettings.test.js. Must be reviewed by the owning team member before merge.

/**
 * The `20261003100000-allowed-group-ids` migration (SCRUM-150): assets written by SCRUM-149 with a
 * single `requiredGroupId` keep exactly the same restriction as a one-item `allowedGroupIds`.
 *
 * Documents are inserted through the raw driver, because the Asset model no longer has the old field
 * and would not let a test write it.
 */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { down, up } from '../../../migrations/20261003100000-allowed-group-ids.js';

const db = () => mongoose.connection.db;
const assets = () => db().collection('assets');
const orgId = new mongoose.Types.ObjectId();

/** Insert an asset the way SCRUM-149's code stored it. */
async function insertOldAsset(requiredGroupId) {
  const doc = { orgId, name: 'Drone', category: 'drone', retiredAt: null };
  if (requiredGroupId !== undefined) {
    doc.requiredGroupId = requiredGroupId;
  }
  const { insertedId } = await assets().insertOne(doc);
  return insertedId;
}
const raw = (id) => assets().findOne({ _id: id });

beforeEach(async () => {
  await assets().deleteMany({});
});

describe('allowed-group-ids migration (SCRUM-150)', () => {
  it('turns a single requiredGroupId into a one-item allowedGroupIds, and drops the old field', async () => {
    const groupId = new mongoose.Types.ObjectId();
    const id = await insertOldAsset(groupId);

    await up(db());

    const asset = await raw(id);
    expect(asset.allowedGroupIds.map(String)).toEqual([String(groupId)]);
    expect(asset).not.toHaveProperty('requiredGroupId');
  });

  it('gives an unrestricted asset an empty list, whether its requiredGroupId was null or absent', async () => {
    const wasNull = await insertOldAsset(null);
    const wasAbsent = await insertOldAsset(undefined);

    await up(db());

    for (const id of [wasNull, wasAbsent]) {
      const asset = await raw(id);
      expect(asset.allowedGroupIds).toEqual([]);
      expect(asset).not.toHaveProperty('requiredGroupId');
    }
  });

  it('is idempotent: running it twice changes nothing more', async () => {
    const groupId = new mongoose.Types.ObjectId();
    const id = await insertOldAsset(groupId);

    await up(db());
    await up(db());

    expect((await raw(id)).allowedGroupIds.map(String)).toEqual([String(groupId)]);
  });

  it('never overwrites a list an admin has already set', async () => {
    const chosen = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const { insertedId } = await assets().insertOne({
      orgId,
      name: 'Forklift',
      category: 'machinery',
      allowedGroupIds: chosen,
    });

    await up(db());

    expect((await raw(insertedId)).allowedGroupIds.map(String)).toEqual(chosen.map(String));
  });

  it('down() keeps the first group, so a restricted asset stays restricted', async () => {
    const [first, second] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const { insertedId: restricted } = await assets().insertOne({
      orgId,
      name: 'Forklift',
      category: 'machinery',
      allowedGroupIds: [first, second],
    });
    const open = await insertOldAsset(undefined);
    await up(db());

    await down(db());

    expect(String((await raw(restricted)).requiredGroupId)).toBe(String(first));
    expect((await raw(open)).requiredGroupId).toBeNull();
    expect(await raw(restricted)).not.toHaveProperty('allowedGroupIds');
  });
});

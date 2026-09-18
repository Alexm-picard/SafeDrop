// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: audit immutability proof: repository exposes only append/query; every Mongoose mutation path throws (SR-8)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for audit-event immutability (SR-8).
 *
 * The audit trail is only evidence if it cannot be rewritten, so this suite goes through every way one
 * might try. The repository exposes only `append()` and `query()`; re-saving an existing document is
 * rejected; unknown fields are refused; a client-supplied timestamp is overwritten on both `create()`
 * and `insertMany()`; and an aggregation with `$out` or `$merge` is refused while read-only
 * aggregations still work.
 *
 * That last one is easy to miss — a writing aggregation could rewrite the whole collection without
 * triggering any update or delete hook.
 */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditEvent, AuditImmutabilityError } from '../../../src/models/AuditEvent.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { record } from '../../../src/services/audit.service.js';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../../src/utils/constants.js';

const orgId = new mongoose.Types.ObjectId();
const actor = { userId: new mongoose.Types.ObjectId(), role: 'ORG_ADMIN' };
const event = () => ({
  actor,
  action: AUDIT_ACTION.ASSET_CREATED,
  targetType: AUDIT_TARGET_TYPE.Asset,
  targetId: new mongoose.Types.ObjectId(),
  before: null,
  after: { name: 'Camera' },
  requestId: 'req-1',
});

describe('audit repository surface', () => {
  it('exposes only append() and query()', () => {
    expect(Object.keys(auditRepo).sort()).toEqual(['append', 'query']);
  });
});

describe('AuditEvent immutability (SR-8)', () => {
  let doc;
  beforeEach(async () => {
    doc = await record(orgId, event());
  });

  it('append() stores a server-set timestamp and returns the row', async () => {
    expect(doc.timestamp).toBeInstanceOf(Date);
    expect(doc.action).toBe('ASSET_CREATED');
    expect(doc.requestId).toBe('req-1');
  });

  it.each([
    [
      'updateOne',
      () => AuditEvent.updateOne({ _id: doc._id }, { $set: { action: 'ASSET_RETIRED' } }),
    ],
    ['updateMany', () => AuditEvent.updateMany({}, { $set: { after: null } })],
    [
      'findOneAndUpdate',
      () => AuditEvent.findOneAndUpdate({ _id: doc._id }, { $set: { action: 'ASSET_RETIRED' } }),
    ],
    ['findOneAndReplace', () => AuditEvent.findOneAndReplace({ _id: doc._id }, event())],
    ['replaceOne', () => AuditEvent.replaceOne({ _id: doc._id }, event())],
    ['deleteOne', () => AuditEvent.deleteOne({ _id: doc._id })],
    ['deleteMany', () => AuditEvent.deleteMany({})],
    ['findOneAndDelete', () => AuditEvent.findOneAndDelete({ _id: doc._id })],
    ['bulkWrite', () => AuditEvent.bulkWrite([{ deleteOne: { filter: { _id: doc._id } } }])],
    ['document.deleteOne', async () => (await AuditEvent.findById(doc._id)).deleteOne()],
  ])('%s throws AuditImmutabilityError and leaves the row untouched', async (_name, attempt) => {
    await expect(attempt()).rejects.toBeInstanceOf(AuditImmutabilityError);
    const stored = await AuditEvent.findById(doc._id);
    expect(stored).not.toBeNull();
    expect(stored.action).toBe('ASSET_CREATED');
  });

  it('re-saving an existing document is rejected', async () => {
    const stored = await AuditEvent.findById(doc._id);
    stored.after = { name: 'changed' };
    await expect(stored.save()).rejects.toThrow();
    expect((await AuditEvent.findById(doc._id)).after).toEqual({ name: 'Camera' });
  });

  it('rejects unknown fields and a client-supplied timestamp is ignored by the repository', async () => {
    await expect(
      AuditEvent.create({
        ...event(),
        orgId,
        actorId: actor.userId,
        actorRole: actor.role,
        extra: 1,
      }),
    ).rejects.toThrow();
    const before = Date.now() - 5000;
    const row = await auditRepo.append(orgId, {
      ...event(),
      actorId: actor.userId,
      actorRole: actor.role,
      timestamp: new Date(0),
    });
    expect(row.timestamp.getTime()).toBeGreaterThan(before);
  });

  it('query() is tenant-scoped, newest first and paginated', async () => {
    await record(orgId, { ...event(), action: AUDIT_ACTION.ASSET_UPDATED });
    await record(new mongoose.Types.ObjectId(), event());
    const page = await auditRepo.query(orgId, { limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].action).toBe('ASSET_UPDATED');
    const filtered = await auditRepo.query(orgId, { action: 'ASSET_CREATED' });
    expect(filtered.total).toBe(1);
  });
});

describe('AuditEvent: the remaining write paths', () => {
  const doc = () => ({
    orgId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: AUDIT_ACTION.ASSET_CREATED,
    targetType: AUDIT_TARGET_TYPE.Asset,
    targetId: new mongoose.Types.ObjectId(),
  });

  it('aggregate() with $merge or $out is refused; read-only aggregations still work', async () => {
    await record(orgId, event());
    await expect(
      AuditEvent.aggregate([{ $match: {} }, { $merge: { into: 'auditevents' } }]),
    ).rejects.toBeInstanceOf(AuditImmutabilityError);
    await expect(
      AuditEvent.aggregate([{ $match: {} }, { $out: 'auditevents' }]),
    ).rejects.toBeInstanceOf(AuditImmutabilityError);
    const counted = await AuditEvent.aggregate([{ $match: {} }, { $count: 'n' }]);
    expect(counted[0].n).toBe(1);
  });

  it('a client-supplied timestamp is overwritten on create() and insertMany()', async () => {
    const before = Date.now() - 5000;
    const created = await AuditEvent.create({ ...doc(), timestamp: new Date(0) });
    expect(created.timestamp.getTime()).toBeGreaterThan(before);
    const [inserted] = await AuditEvent.insertMany([{ ...doc(), timestamp: new Date(0) }]);
    expect(inserted.timestamp.getTime()).toBeGreaterThan(before);
    const stored = await AuditEvent.findById(inserted._id);
    expect(stored.timestamp.getTime()).toBeGreaterThan(before);
  });
});

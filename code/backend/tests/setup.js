// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: per-file Mongoose connection to a unique database with the index migration applied; wipe between tests
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { up } from '../migrations/20260916000000-initial-indexes.js';
import { configureMongoose } from '../src/config/db.js';

beforeAll(async () => {
  const uri = inject('mongoUri');
  const dbName = `safedrop_test_${randomUUID().slice(0, 8)}`;
  const dbUri = new URL(uri);
  dbUri.pathname = `/${dbName}`;
  process.env.MONGODB_URI = dbUri.toString();
  configureMongoose();
  await mongoose.connect(uri, { dbName });
  // Same indexes as production: unique constraints and TTL behave identically in tests.
  await up(mongoose.connection.db);
});

afterEach(async () => {
  // Driver-level wipe (bypasses model hooks on purpose; the audit model forbids Mongoose deletes).
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db.dropDatabase();
  }
  await mongoose.disconnect();
});

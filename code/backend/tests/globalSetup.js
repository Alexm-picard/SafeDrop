// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: one in-memory MongoDB replica set for the whole run (transactions need a replica set)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** @param {import('vitest/node').GlobalSetupContext} ctx */
export default async function globalSetup({ provide }) {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop({ doCleanup: true, force: true });
  };
}

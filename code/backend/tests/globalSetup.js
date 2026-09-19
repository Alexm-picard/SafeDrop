// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: one in-memory MongoDB replica set for the whole run (transactions need a replica set)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Vitest global setup: start one in-memory MongoDB for the whole test run.
 *
 * Runs once per run, before any test file, and the returned function tears it down afterwards.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Start an in-memory MongoDB replica set and publish its URI to the test files.
 *
 * A *replica set* rather than a standalone server, even with a single node: MongoDB only supports
 * transactions on a replica set, and the services wrap their writes in one. A standalone would make
 * every transactional test fail for a reason that has nothing to do with the code under test.
 *
 * The URI is passed to test files through Vitest's `provide`/`inject`, which is how a value crosses
 * from the global setup process into the workers.
 * @param {import('vitest/node').GlobalSetupContext} ctx
 * @returns {Promise<() => Promise<void>>} the teardown function
 */
export default async function globalSetup({ provide }) {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop({ doCleanup: true, force: true });
  };
}

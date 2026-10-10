// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents; TEST_MONGODB_URI fallback added later)
// AI-Assisted Areas: one in-memory MongoDB replica set for the whole run (transactions need a replica set); opt-in TEST_MONGODB_URI fallback so the suite can run inside the Alpine-based backend container (Lab 3)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18); reviewed and approved by Amber Rastella (PR #7, 2026-09-18); latest changes reviewed and approved by Amber Rastella (PR #47, 2026-09-28); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. TEST_MONGODB_URI added after discovering mongodb-memory-server cannot download a binary on Alpine (no official build for its C library) while satisfying Lab 3's "run tests inside the container" requirement. Unset by default; changes nothing for host or CI runs.

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
 *
 * `TEST_MONGODB_URI` is an escape hatch for one situation only: running the suite inside the backend's
 * own Docker image (`docker compose exec backend ...`, Lab 3's "run your tests in the container"
 * requirement). That image is Alpine-based, and `mongodb-memory-server` cannot start there — MongoDB
 * ships no official build for Alpine's C library, so the binary download itself refuses with
 * `Unknown/unsupported linux "alpine"`, regardless of network access or what else is installed. When
 * this variable is set, its value is used as-is instead of starting an in-memory instance; the real
 * `mongo` service already running in docker-compose (a genuine replica set) satisfies the transaction
 * requirement above just as well. Unset everywhere else — plain `npm test` on the host and CI's
 * `ubuntu-latest` job — so this changes nothing for anyone not deliberately opting in.
 * @param {import('vitest/node').GlobalSetupContext} ctx
 * @returns {Promise<() => Promise<void>>} the teardown function
 */
export default async function globalSetup({ provide }) {
  const externalUri = process.env.TEST_MONGODB_URI;
  if (externalUri) {
    provide('mongoUri', externalUri);
    return async () => {}; // the real mongo service outlives the test run; nothing to tear down
  }
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop({ doCleanup: true, force: true });
  };
}

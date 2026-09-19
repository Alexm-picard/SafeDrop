// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Mongoose global settings (sanitizeFilter, autoIndex off) and connection lifecycle
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * MongoDB connection lifecycle and global Mongoose configuration.
 *
 * Every process that talks to MongoDB (the API server, migrations, the test harness) goes through
 * this module so that the security-relevant Mongoose settings are applied in exactly one place.
 * It owns three concerns: the one-time global configuration, opening/closing the connection, and
 * running a unit of work inside a transaction.
 *
 * Exports:
 *  - `configureMongoose()` — apply the global settings once (idempotent).
 *  - `connectDb(uri, options)` — configure, then connect, and return the connection.
 *  - `disconnectDb()` — close the connection.
 *  - `pingDb(options)` — prove the database answers right now; throws if it does not.
 *  - `withTransaction(fn)` — run `fn` inside a MongoDB transaction.
 */
import mongoose from 'mongoose';

let configured = false;

/**
 * Global Mongoose settings. Called once by server.js and by the test harness.
 *  - sanitizeFilter: query operators inside filter values are neutralised (SR-6, SDD §6.7).
 *  - autoIndex off: indexes come from migrations run at deploy time, never at boot (arch review F3/F6).
 *  - strictQuery 'throw': a filter on a path that is not in the schema throws. A mistyped tenant key
 *    (orgID) must fail loudly, never silently widen a query to every organisation (SR-2).
 */
export function configureMongoose() {
  if (configured) {
    return mongoose;
  }
  mongoose.set('sanitizeFilter', true);
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  mongoose.set('strictQuery', 'throw');
  configured = true;
  return mongoose;
}

/**
 * @param {string} uri
 * @param {import('mongoose').ConnectOptions} [options]
 */
export async function connectDb(uri, options = {}) {
  configureMongoose();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30_000, ...options });
  return mongoose.connection;
}

/**
 * Close the Mongoose connection and every pooled socket.
 *
 * Called by the server's shutdown handler and by the test teardown; leaving the pool open keeps
 * the Node process alive, so a missing call here shows up as a test run that never exits.
 * @returns {Promise<void>}
 */
export async function disconnectDb() {
  await mongoose.disconnect();
}

/**
 * Prove the database can answer right now, for GET /health. Resolves if it can, throws if not.
 *
 * Two checks, because neither is enough alone. `readyState` is read first so a connection Mongoose
 * already knows is down fails instantly, without a round trip. But `readyState` lags: it still reads
 * connected for a moment after mongod goes away, until the driver notices. The `ping` closes that
 * gap — it is the cheapest command the server has, and touches no collection.
 *
 * `timeoutMS` bounds the ping. Without it a ping against a dead server waits out the full
 * `serverSelectionTimeoutMS` (30 s), far longer than a health probe waits for an answer.
 * @param {{ timeoutMS?: number }} [options]
 * @returns {Promise<void>}
 */
export async function pingDb({ timeoutMS = 2_000 } = {}) {
  const { readyState } = mongoose.connection;
  if (readyState !== mongoose.ConnectionStates.connected) {
    throw new Error(`database not connected (readyState ${readyState})`);
  }
  await mongoose.connection.db.command({ ping: 1 }, { timeoutMS });
}

/**
 * Run `fn(session)` inside a MongoDB transaction. Requires a replica set (Compose starts one).
 * Used by services so that a state change and its audit event commit or roll back together (OD-2, NFR-2).
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

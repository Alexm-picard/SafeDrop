// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Mongoose global settings (sanitizeFilter, autoIndex off) and connection lifecycle
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: process bootstrap: connect Mongoose, listen, graceful shutdown
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Process entry point: connect to MongoDB, start listening, and shut down cleanly.
 *
 * Kept separate from app.js so the application can be imported and exercised by supertest without
 * opening a port or a database connection. This file is what `npm start` and the Docker image run.
 */
import app from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

/**
 * Connect to the database, start the HTTP server, and install signal handlers.
 *
 * The database connection is awaited *before* listening, so the process never accepts a request it
 * cannot serve — a container that cannot reach MongoDB fails its health check instead of returning
 * errors.
 *
 * Shutdown is graceful: on SIGTERM or SIGINT (Render deploys, `docker compose down`, Ctrl-C) the
 * server stops accepting connections, lets in-flight requests finish, closes the database and exits.
 * The 10-second timer is the backstop for a connection that will not drain, and is `unref()`d so it
 * cannot itself keep the process alive once everything else is done.
 * @returns {Promise<void>}
 */
async function main() {
  await connectDb(env.MONGODB_URI);
  logger.info({ env: env.NODE_ENV }, 'database connected');

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'SafeDrop API listening');
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Force exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

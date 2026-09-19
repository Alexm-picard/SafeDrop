// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: GET /health database check: healthy, connection closed, and ping failing while readyState still reads connected
// Human Contributions: pending team review
// Notes: Written for SCRUM-133. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for GET /health and its database check (SCRUM-133).
 *
 * /health is what the Compose healthcheck and Render's probe read, so it has to fail when the API
 * could not serve a real request, not only when the process is gone. Two failure modes are covered
 * because `pingDb()` checks two things: a connection Mongoose knows is closed, and a connection that
 * still reads connected while the server does not answer (readyState lags behind a dead mongod).
 *
 * Both 503s are asserted with `toEqual` on the whole body, so any extra field — a driver message, a
 * debug stack, a readyState — fails the test (SDD §6.5).
 *
 * The connection-closed test reconnects in `finally`: tests/setup.js wipes collections after each
 * test through the same connection, and drops the database after the file.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';

const notReady = (res) => ({
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service not ready',
    requestId: res.headers['x-request-id'],
  },
});

describe('GET /health', () => {
  it('is 200 and reports the database connected when Mongo answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'connected', uptime: expect.any(Number) });
  });

  it('is 503 with nothing but "not ready" when the connection is down', async () => {
    await mongoose.disconnect();
    try {
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual(notReady(res));
    } finally {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('is 503 when readyState reads connected but the ping fails, and the ping is bounded', async () => {
    expect(mongoose.connection.readyState).toBe(mongoose.ConnectionStates.connected);
    const command = vi
      .spyOn(mongoose.connection.db, 'command')
      .mockRejectedValue(new Error('connection 3 to 127.0.0.1:27017 closed'));
    try {
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual(notReady(res));
      expect(command).toHaveBeenCalledWith({ ping: 1 }, { timeoutMS: 2_000 });
    } finally {
      command.mockRestore();
    }
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: errorHandler unit tests: status mapping, { error: { code, message } } shape, production hides stack/DB text (SDD §6.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { describe, expect, it, vi } from 'vitest';
import { createErrorHandler, notFound } from '../../../src/middleware/errorHandler.js';
import {
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  RateLimitError,
  StateTransitionError,
  ValidationError,
} from '../../../src/utils/errors.js';
import { createLogger } from '../../../src/utils/logger.js';

function mockRes() {
  const res = { statusCode: 200, headersSent: false, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.end = () => res;
  return res;
}

const lines = [];
const logger = createLogger({ level: 'debug', write: (line) => lines.push(JSON.parse(line)) });
const handle = (err, { isProduction = true } = {}) => {
  const res = mockRes();
  createErrorHandler({ isProduction, logger })(
    err,
    { id: 'req-1', method: 'GET', originalUrl: '/x' },
    res,
    () => {},
  );
  return res;
};

describe('errorHandler', () => {
  it.each([
    [new ValidationError('bad', [{ path: 'a' }]), 400, 'VALIDATION_ERROR'],
    [new AuthError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new StateTransitionError('PENDING', 'RETURNED'), 409, 'INVALID_STATE_TRANSITION'],
    [new RateLimitError(), 429, 'RATE_LIMITED'],
    [new NotImplementedError('SCRUM-1'), 501, 'NOT_IMPLEMENTED'],
  ])('maps %s to its status and code', (err, status, code) => {
    const res = handle(err);
    expect(res.statusCode).toBe(status);
    expect(res.body.error).toMatchObject({ code, message: err.message, requestId: 'req-1' });
  });

  it('includes validation details and never a stack for 4xx', () => {
    const res = handle(
      new ValidationError('bad', [{ location: 'body', path: 'email', message: 'x' }]),
      { isProduction: false },
    );
    expect(res.body.error.details).toEqual([{ location: 'body', path: 'email', message: 'x' }]);
    expect(res.body.error.debug).toBeUndefined();
  });

  it('hides the stack and the original message for unexpected errors in production', () => {
    const res = handle(new Error('secret internal detail'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-1' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });

  it('exposes a debug block for 5xx only outside production', () => {
    const res = handle(new Error('dev detail'), { isProduction: false });
    expect(res.body.error.debug.message).toBe('dev detail');
    expect(res.body.error.debug.stack).toContain('Error: dev detail');
  });

  it('never leaks MongoDB error text (duplicate key → 409, cast → 400)', () => {
    const dup = Object.assign(
      new Error('E11000 duplicate key error collection: safedrop.users index: orgId_email_unique'),
      {
        name: 'MongoServerError',
        code: 11000,
        keyValue: { email: 'a@b.co' },
      },
    );
    const res = handle(dup);
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|safedrop\.users|a@b\.co/);

    const cast = Object.assign(new Error('Cast to ObjectId failed for value "zzz"'), {
      name: 'CastError',
    });
    expect(handle(cast).statusCode).toBe(400);
    expect(JSON.stringify(handle(cast).body)).not.toContain('zzz');
  });

  it('maps body-parser errors to 400/413', () => {
    expect(
      handle(Object.assign(new Error('x'), { type: 'entity.parse.failed', status: 400 })).body.error
        .code,
    ).toBe('INVALID_JSON');
    expect(
      handle(Object.assign(new Error('x'), { type: 'entity.too.large', status: 413 })).statusCode,
    ).toBe(413);
  });

  it('logs 5xx as error and 4xx as warn/info with the request id', () => {
    lines.length = 0;
    handle(new Error('boom'));
    handle(new AuthError());
    handle(new NotFoundError());
    expect(lines.map((l) => l.level)).toEqual(['error', 'warn', 'info']);
    expect(lines[0]).toMatchObject({ requestId: 'req-1', status: 500 });
    expect(lines[0].err.stack).toContain('boom');
  });

  it('ends the response without a body when headers were already sent', () => {
    const res = mockRes();
    res.headersSent = true;
    const end = vi.spyOn(res, 'end');
    createErrorHandler({ isProduction: true, logger })(
      new Error('late'),
      { id: 'r' },
      res,
      () => {},
    );
    expect(end).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('notFound forwards a NotFoundError', () => {
    let captured;
    notFound({}, {}, (err) => {
      captured = err;
    });
    expect(captured).toBeInstanceOf(NotFoundError);
  });
});

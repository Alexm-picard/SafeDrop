// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: expected errors (AppError subclasses) never carry a debug block, even outside production
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit test for the error handler's debug block.
 *
 * Split out from errorHandler.test.js because it needs a different environment: the debug block with
 * its stack trace appears only outside production and only for unexpected 5xx errors. Keeping it
 * separate avoids reconfiguring the shared handler in the middle of the main suite.
 */
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../../src/middleware/errorHandler.js';
import { NotImplementedError } from '../../../src/utils/errors.js';
import { createLogger } from '../../../src/utils/logger.js';

describe('errorHandler debug block', () => {
  it('is attached only to unexpected 5xx errors outside production', () => {
    const logger = createLogger({ level: 'fatal', write: () => {} });
    const res = {
      statusCode: 200,
      headersSent: false,
      status: (c) => ((res.statusCode = c), res),
      json: (b) => ((res.body = b), res),
      end: () => res,
    };
    createErrorHandler({ isProduction: false, logger })(
      new NotImplementedError('SCRUM-1'),
      { id: 'r' },
      res,
      () => {},
    );
    expect(res.statusCode).toBe(501);
    expect(res.body.error.debug).toBeUndefined();
    createErrorHandler({ isProduction: false, logger })(
      new Error('boom'),
      { id: 'r' },
      res,
      () => {},
    );
    expect(res.body.error.debug.message).toBe('boom');
  });
});

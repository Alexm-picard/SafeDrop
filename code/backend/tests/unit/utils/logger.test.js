// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: logger tests: level threshold, JSON lines, error serialisation, child bindings
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for the logger.
 *
 * Covers the level threshold — lines below the configured level are not written at all — and child
 * bindings, which are how a request id reaches every line produced while handling one request.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/utils/logger.js';

describe('createLogger', () => {
  it('writes JSON lines at or above the configured level', () => {
    const lines = [];
    const log = createLogger({ level: 'warn', write: (l) => lines.push(JSON.parse(l)) });
    log.debug('hidden');
    log.info({ a: 1 }, 'hidden too');
    log.warn({ requestId: 'r1' }, 'shown');
    log.error(new Error('boom'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      requestId: 'r1',
      msg: 'shown',
      name: 'safedrop',
    });
    expect(lines[1].err).toMatchObject({ name: 'Error', message: 'boom' });
    expect(lines[1].msg).toBe('boom');
  });

  it('child loggers carry bindings', () => {
    const lines = [];
    const log = createLogger({ level: 'debug', write: (l) => lines.push(JSON.parse(l)) }).child({
      requestId: 'r2',
    });
    log.info({ err: new Error('x') }, 'with err field');
    expect(lines[0]).toMatchObject({ requestId: 'r2', msg: 'with err field' });
    expect(lines[0].err.message).toBe('x');
  });
});

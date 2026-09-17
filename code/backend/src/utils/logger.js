// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dependency-free leveled JSON logger with child bindings (requestId correlation)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// Deliberately tiny so the skeleton adds no logging dependency. Swap for pino later if needed;
// keep the same call shape: logger.info({ requestId }, 'message').

import { env } from '../config/env.js';

export const LEVELS = Object.freeze({ fatal: 60, error: 50, warn: 40, info: 30, debug: 20 });

function serializeError(err) {
  if (!(err instanceof Error)) {
    return err;
  }
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.status,
    stack: err.stack,
    cause: err.cause instanceof Error ? serializeError(err.cause) : err.cause,
  };
}

/**
 * @param {{ level?: keyof typeof LEVELS, name?: string, bindings?: object, write?: (line: string) => void }} options
 */
export function createLogger({ level = 'info', name = 'safedrop', bindings = {}, write } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const sink = write ?? ((line) => process.stdout.write(`${line}\n`));

  const emit = (levelName, first, second) => {
    if (LEVELS[levelName] < threshold) {
      return;
    }
    let fields = {};
    let msg = first;
    if (first instanceof Error) {
      fields = { err: serializeError(first) };
      msg = second ?? first.message;
    } else if (first && typeof first === 'object') {
      fields = { ...first };
      if (fields.err instanceof Error) {
        fields.err = serializeError(fields.err);
      }
      msg = second;
    }
    sink(
      JSON.stringify({
        level: levelName,
        time: new Date().toISOString(),
        name,
        ...bindings,
        ...fields,
        msg,
      }),
    );
  };

  return {
    level,
    fatal: (a, b) => emit('fatal', a, b),
    error: (a, b) => emit('error', a, b),
    warn: (a, b) => emit('warn', a, b),
    info: (a, b) => emit('info', a, b),
    debug: (a, b) => emit('debug', a, b),
    child: (extra) =>
      createLogger({ level, name, bindings: { ...bindings, ...extra }, write: sink }),
  };
}

export const logger = createLogger({ level: env.LOG_LEVEL });

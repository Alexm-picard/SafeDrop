// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: dependency-free leveled JSON logger with child bindings (requestId correlation)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.
//
// Deliberately tiny so the skeleton adds no logging dependency. Swap for pino later if needed;
// keep the same call shape: logger.info({ requestId }, 'message').

/**
 * A dependency-free leveled JSON logger with child bindings.
 *
 * One line of JSON per event, written to stdout, which is what Render and `docker compose logs`
 * expect. `child()` bindings are how a request id is attached to every line produced while handling
 * one request (see middleware/requestId.js), giving log correlation without a per-call parameter.
 *
 * Exports:
 *  - `LEVELS` — level name → numeric severity, used for threshold comparison.
 *  - `createLogger(options)` — build a logger with a level, name, bindings and output sink.
 *  - `logger` — the process-wide logger, at the level set by `LOG_LEVEL`.
 */
import { env } from '../config/env.js';

export const LEVELS = Object.freeze({ fatal: 60, error: 50, warn: 40, info: 30, debug: 20 });

/**
 * Flatten an Error into a plain, JSON-safe object.
 *
 * `JSON.stringify(new Error('x'))` yields `{}` because `message` and `stack` are not enumerable,
 * so the fields that matter are copied out explicitly. `cause` is followed recursively so a
 * wrapped error keeps its origin in the log line.
 * @param {unknown} err the value logged as an error
 * @returns {unknown} a serialisable object, or the value unchanged when it is not an Error
 */
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
 * Build a logger that writes one JSON line per event.
 *
 * Each level method accepts either `(msg)`, `(fields, msg)` or `(err, msg)`; an Error in either
 * position is serialised under an `err` key. Events below the configured level are dropped without
 * building the line. `child(extra)` returns a logger that merges `extra` into every subsequent line
 * and shares this logger's sink, which is how a request id reaches every line of one request.
 * @param {{ level?: keyof typeof LEVELS, name?: string, bindings?: object, write?: (line: string) => void }} [options]
 * @returns {{ level: string, fatal: Function, error: Function, warn: Function, info: Function, debug: Function, child: (extra: object) => object }}
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

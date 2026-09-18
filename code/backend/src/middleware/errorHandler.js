// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: single final error middleware → { error: { code, message } }; no stack/DB text in production (arch review F2, SDD §6.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 10: the 404 handler and the single error handler every failure ends up in.
 *
 * One rule governs this file: only errors this codebase raised on purpose may speak to the client.
 * An `AppError` carries a status, a code and a message written to be read by a user. Everything else
 * — a Mongo duplicate-key error, a cast failure, a bug — is logged in full and answered with a
 * generic message, because driver errors carry field names, values and query text that describe the
 * schema to an attacker.
 *
 * Every response has the same shape: `{ error: { code, message, details?, requestId? } }`, so the
 * frontend has exactly one error format to handle, and the request id lets a user's report be matched
 * to a log line.
 *
 * Exports: `notFound`, `createErrorHandler(options)`, `errorHandler`.
 */
import { env } from '../config/env.js';
import { isAppError, NotFoundError } from '../utils/errors.js';
import { logger as defaultLogger } from '../utils/logger.js';

/**
 * Turn anything that fell through every router into a 404 in the standard error shape.
 *
 * Mounted after all routes, so an unknown path produces the same `{ error: { code, message } }` body
 * as any other failure rather than Express's default HTML page.
 * @param {import('express').Request} _req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export function notFound(_req, _res, next) {
  next(new NotFoundError('Route not found'));
}

const BODY_PARSER_CODES = {
  'entity.parse.failed': ['INVALID_JSON', 'Request body is not valid JSON'],
  'entity.too.large': ['PAYLOAD_TOO_LARGE', 'Request body too large'],
  'encoding.unsupported': ['UNSUPPORTED_ENCODING', 'Unsupported content encoding'],
  'charset.unsupported': ['UNSUPPORTED_CHARSET', 'Unsupported charset'],
  'entity.verify.failed': ['INVALID_BODY', 'Request body failed verification'],
  'request.aborted': ['REQUEST_ABORTED', 'Request aborted'],
};

/**
 * Map any thrown value to the status, code and message the client will see.
 *
 * The order matters. Deliberate `AppError`s pass through with their own message. Body-parser
 * failures get a specific but harmless code. Mongo errors are recognised (11000 duplicate key,
 * `CastError`, Mongoose `ValidationError`) and deliberately flattened to generic text — the server
 * knows which unique index was violated, the client is told only that something unique already
 * exists. Anything unrecognised is a 500 with "Something went wrong".
 * @param {unknown} err
 * @returns {{ status: number, code: string, message: string, details?: unknown }}
 */
function classify(err) {
  if (isAppError(err)) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err && typeof err.type === 'string' && BODY_PARSER_CODES[err.type]) {
    const [code, message] = BODY_PARSER_CODES[err.type];
    return { status: err.status ?? 400, code, message };
  }
  // Mongoose / MongoDB errors: never leak field names, values or query text.
  if (err && err.code === 11000) {
    return {
      status: 409,
      code: 'CONFLICT',
      message: 'A record with the same unique value already exists',
    };
  }
  if (err && err.name === 'CastError') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid identifier' };
  }
  if (err && err.name === 'ValidationError') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid data' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

/**
 * Build the Express error handler.
 *
 * Logging is levelled by what the failure means: 5xx is `error` (our bug), 401/403/429 is `warn`
 * (worth watching for an attack pattern), and the rest is `info` (an ordinary bad request). The
 * full error object goes to the log; only `classify()`'s output goes to the client.
 *
 * If headers were already sent, the response is simply ended — the status line is long gone, and
 * trying to write a body would throw on top of the original error.
 *
 * Stack traces are attached to 5xx bodies outside production only; the `isProduction` flag is a
 * parameter rather than a direct `env` read so tests can pin production behaviour and prove the
 * traces stay out.
 * @param {{ isProduction?: boolean, logger?: object }} [options]
 * @returns {import('express').ErrorRequestHandler}
 */
export function createErrorHandler({
  isProduction = env.isProduction,
  logger = defaultLogger,
} = {}) {
  // Four parameters are required for Express to treat this as an error handler.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    const { status, code, message, details } = classify(err);
    const requestId = req.id;

    const logFields = { requestId, method: req.method, path: req.originalUrl, status, code };
    if (status >= 500) {
      logger.error({ ...logFields, err }, 'request failed');
    } else if (status === 401 || status === 403 || status === 429) {
      logger.warn({ ...logFields, reason: err?.message }, 'request rejected');
    } else {
      logger.info({ ...logFields, reason: err?.message }, 'request rejected');
    }

    if (res.headersSent) {
      return res.end();
    }

    const body = { error: { code, message } };
    if (details !== undefined) {
      body.error.details = details;
    }
    if (requestId) {
      body.error.requestId = requestId;
    }
    if (!isProduction && status >= 500 && err instanceof Error && !isAppError(err)) {
      // Development/test aid only. The production branch above never reaches this.
      body.error.debug = { message: err.message, stack: err.stack };
    }
    return res.status(status).json(body);
  };
}

export const errorHandler = createErrorHandler();

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: single final error middleware → { error: { code, message } }; no stack/DB text in production (arch review F2, SDD §6.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { env } from '../config/env.js';
import { isAppError, NotFoundError } from '../utils/errors.js';
import { logger as defaultLogger } from '../utils/logger.js';

/** Chain step 10a: anything that fell through every router is a 404 in the standard shape. */
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
 * Translate any thrown value into { status, code, message, details, expose }.
 * Only AppError messages are considered client-safe; everything else gets a generic message.
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
 * Chain step 10b. Factory so tests can pin production behaviour and capture logs.
 * @param {{ isProduction?: boolean, logger?: import('../utils/logger.js').logger }} [options]
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

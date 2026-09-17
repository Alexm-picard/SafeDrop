// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed error hierarchy mapped to HTTP status + { error: { code, message } } (SDD §6.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Base class for every error the API deliberately returns. `message` is always safe to show to a
 * client; anything sensitive belongs in `cause` (logged, never sent).
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, code: string, details?: unknown, cause?: unknown }} options
   */
  constructor(message, { status, code, details, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.status = status ?? 500;
    this.code = code ?? 'INTERNAL_ERROR';
    this.details = details;
    this.isAppError = true;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', cause) {
    super(message, { status: 401, code: 'UNAUTHENTICATED', cause });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

/** Thrown by checkout.service assertTransition() when a request cannot move between two states. */
export class StateTransitionError extends AppError {
  constructor(from, to, message) {
    super(message ?? `Cannot transition from ${from} to ${to}`, {
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { from, to },
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Content-Type must be application/json') {
    super(message, { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, try again later') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

/** Sprint stubs throw this; the route exists, the behaviour is owned by a later ticket. */
export class NotImplementedError extends AppError {
  constructor(ticket, message) {
    super(message ?? `Not implemented yet${ticket ? ` (${ticket})` : ''}`, {
      status: 501,
      code: 'NOT_IMPLEMENTED',
      details: ticket ? { ticket } : undefined,
    });
  }
}

export function isAppError(err) {
  return Boolean(err) && err.isAppError === true;
}

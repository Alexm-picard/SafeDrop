// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed error hierarchy mapped to HTTP status + { error: { code, message } } (SDD §6.5)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * The typed error hierarchy the API answers with (SDD §6.5).
 *
 * Every deliberate failure is an `AppError` subclass carrying the HTTP status and the machine-readable
 * `code` that the error handler serialises as `{ error: { code, message, details? } }`. Throwing a
 * typed error is how any layer — middleware, service, repository — reports a failure without knowing
 * anything about Express: the class fixes the status, so a service never hard-codes `res.status(409)`.
 *
 * The `message` of these errors is always safe to show a client. Anything sensitive (a driver error,
 * a failed lookup) belongs in `cause`, which is logged and never sent.
 *
 * Exports: `AppError` and its subclasses `ValidationError` (400), `AuthError` (401), `ForbiddenError`
 * (403), `InvitationError` (400), `NotFoundError` (404), `ConflictError` (409), `StateTransitionError` (409),
 * `UnsupportedMediaTypeError` (415), `RateLimitError` (429), `NotImplementedError` (501),
 * `ServiceUnavailableError` (503), plus the `isAppError` type guard.
 */

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

/** 400 — the request did not match its schema. `details` carries the per-field issues. */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

/** 401 — no session, or a token that could not be verified. The reason stays in `cause`. */
export class AuthError extends AppError {
  constructor(message = 'Authentication required', cause) {
    super(message, { status: 401, code: 'UNAUTHENTICATED', cause });
  }
}

/** 403 — authenticated, but the caller's role does not hold the permission the route declares. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

/**
 * 404 — no such record *in the caller's organisation*. Repositories scope every read by tenant, so a
 * record that belongs to another organisation is reported as missing rather than forbidden: telling
 * the caller it exists would itself leak across the tenant boundary (SR-2).
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

/** 409 — the request is well-formed but collides with current state (duplicate slug, unit already out). */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

/**
 * 409 — a checkout request was asked to move between two states the state machine does not connect
 * (approving something already cancelled, returning something never checked out). Thrown by
 * checkout.service assertTransition(); `details` names both states so the client can say which.
 */
export class StateTransitionError extends AppError {
  constructor(from, to, message) {
    super(message ?? `Cannot transition from ${from} to ${to}`, {
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { from, to },
    });
  }
}

/** 415 — a state-changing request arrived without a JSON content type (see middleware/security.js). */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Content-Type must be application/json') {
    super(message, { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
}

/** 429 — the caller exceeded a rate limit; currently only the auth limiter raises it. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, try again later') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

/**
 * 501 — the route exists, is authenticated and authorized, but its behaviour belongs to a later
 * ticket. Sprint stubs throw this so the API surface and its permissions can be tested now, and the
 * ticket id travels in `details` so a caller (and the frontend placeholder) can name what is missing.
 */
export class NotImplementedError extends AppError {
  constructor(ticket, message) {
    super(message ?? `Not implemented yet${ticket ? ` (${ticket})` : ''}`, {
      status: 501,
      code: 'NOT_IMPLEMENTED',
      details: ticket ? { ticket } : undefined,
    });
  }
}

/**
 * 503 — the process is up but cannot serve requests because a dependency (the database) is not
 * reachable. Raised by GET /health. The client learns only "not ready"; the underlying driver error
 * travels in `cause`, which is logged and never sent (SDD §6.5).
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service not ready', cause) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', cause });
  }
}

/**
 * Type guard for errors this API raised on purpose.
 *
 * The error handler uses it to decide between echoing a known status and code, and treating the
 * throw as an unexpected 500 whose message must not reach the client. It tests the `isAppError`
 * flag rather than `instanceof` so that an error crossing a module or realm boundary — two copies
 * of the module under vitest, for instance — is still recognised.
 * @param {unknown} err
 * @returns {boolean} true when `err` is one of this file's error classes
 */
export function isAppError(err) {
  return Boolean(err) && err.isAppError === true;
}

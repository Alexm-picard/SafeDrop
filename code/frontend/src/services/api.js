// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the single fetch wrapper: credentials, JSON only, typed ApiError, one single-flight refresh + one retry on 401 (SDD §2.3.1, §6.3)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// This is the ONLY module in the SPA allowed to call fetch (ESLint enforces it for components,

/**
 * The HTTP client every API call in the SPA goes through.
 *
 * This is the only module allowed to call `fetch` — ESLint enforces that for components, pages, hooks
 * and context — so four things are true everywhere by construction:
 *
 * **Credentials travel as cookies.** `credentials: 'include'` on every request; no token is ever read
 * or stored by JavaScript, which is what keeps an XSS from becoming session theft.
 *
 * **Errors have one shape.** Any non-2xx becomes an `ApiError` carrying the API's `code`, message and
 * validation details, so UI code catches one type rather than inspecting responses.
 *
 * **Expiry is handled once.** A 401 on a protected endpoint triggers a single shared refresh and one
 * retry. If that fails, an `expired` event tells AuthProvider to drop the session.
 *
 * **State-changing requests are JSON.** The `Content-Type` the API requires (and the CSRF defence it
 * is part of) is set here, not remembered at each call site.
 *
 * Exports: `ApiError`, `apiRequest`, `refreshSession`, `sessionEvents`, `resolveUrl`, `isApiError`,
 * `errorMessage`.
 */

/**
 * A failed API call, carrying everything the backend's error body provided.
 *
 * Mirrors the `{ error: { code, message, details, requestId } }` shape that middleware/errorHandler.js
 * produces, so UI code can branch on a stable `code` instead of matching on message text. The
 * `requestId` is what a user can quote in a bug report to find the matching server log.
 */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable code from the API's { error } body
   * @param {string} message human-readable message
   * @param {import('../types/api').ApiErrorDetail[] | Record<string, unknown>} [details]
   * @param {string} [requestId]
   */
  constructor(status, code, message, details, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  /**
   * Flatten validation details into `{ fieldPath: message }` for rendering beside form inputs.
   *
   * Only the first message per field is kept — a field with three problems needs one line of help, not
   * three. Returns an empty object when the error carried no field details, so callers can use it
   * unconditionally.
   * @returns {Record<string, string>}
   */
  fieldErrors() {
    if (!Array.isArray(this.details)) {
      return {};
    }
    const out = {};
    for (const detail of this.details) {
      if (detail.path && !(detail.path in out)) {
        out[detail.path] = detail.message;
      }
    }
    return out;
  }
}
/**
 * Event target announcing session death.
 *
 * An `expired` event fires when a 401 could not be recovered by refreshing. AuthProvider listens and
 * resets to anonymous. Using an event rather than an import lets this module tell the auth context
 * something without depending on it, which would be a cycle.
 */
export const sessionEvents = new EventTarget();
/**
 * Endpoints where a 401 is the answer rather than something to refresh around.
 *
 * Login and organisation creation return 401 for bad credentials; refresh and logout are themselves
 * the session machinery. Retrying any of them after a refresh would be pointless, and for refresh
 * itself, infinitely recursive.
 */
const NO_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/accept-invite',
  '/api/organizations',
]);
/**
 * Resolve the API's base URL.
 *
 * `VITE_API_BASE` wins when set (a split-origin deployment); otherwise requests go to the page's own
 * origin, where the Vite dev proxy or the Vercel rewrite forwards `/api/*` to the backend (OD-1
 * Option A). The `window` check keeps this working under test and SSR, where there is no window.
 * @returns {string}
 */
function baseUrl() {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured) {
    return configured;
  }
  // Same origin: the Vite dev proxy / Vercel rewrite forwards /api/* to the API (OD-1 Option A).
  return typeof window !== 'undefined' ? window.location.origin : '';
}
/**
 * Turn an API path into an absolute URL against the configured base.
 * @param {string} path e.g. `/api/assets`
 * @returns {string}
 */
export function resolveUrl(path) {
  return new URL(path, baseUrl()).toString();
}
/**
 * Read a response body as JSON, tolerating the cases where there is not one.
 *
 * A 204, an empty body, or unparseable text all yield `undefined` rather than throwing. Error
 * responses are the reason: a proxy timeout or a crash can return HTML, and failing to parse it must
 * not replace the real HTTP status with a JSON syntax error.
 * @param {Response} res
 * @returns {Promise<unknown|undefined>}
 */
async function parseBody(res) {
  if (res.status === 204) {
    return undefined;
  }
  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/**
 * Does this parsed body look like the API's error envelope?
 * @param {unknown} value
 * @returns {boolean}
 */
function isErrorBody(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}
/**
 * Build an `ApiError` from a failed response.
 *
 * When the body is the API's own envelope, its code, message and details are used. Otherwise — a
 * proxy error page, a gateway timeout — a generic `HTTP_ERROR` is built from the status, so callers
 * still receive an `ApiError` rather than something unrecognisable.
 * @param {Response} res
 * @param {unknown} body
 * @returns {ApiError}
 */
function toApiError(res, body) {
  if (isErrorBody(body)) {
    const { code, message, details, requestId } = body.error;
    return new ApiError(res.status, code, message, details, requestId);
  }
  return new ApiError(
    res.status,
    'HTTP_ERROR',
    res.statusText || `Request failed with status ${res.status}`,
  );
}
/**
 * Perform one fetch and return the response with its parsed body.
 *
 * The single place request defaults are applied: cookies included, JSON accepted, and — for anything
 * other than GET — a `Content-Type: application/json` header with a JSON body, which the API requires
 * (a request without it is refused with 415 as part of the CSRF defence). A body defaults to `{}` so
 * a POST with nothing to send still sends valid JSON.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} options
 * @returns {Promise<{ res: Response, data: unknown }>}
 */
async function send(path, { method = 'GET', body, signal }) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers, credentials: 'include', signal };
  if (method !== 'GET') {
    // State-changing requests must be application/json with a JSON body, or the API answers 415.
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(resolveUrl(path), init);
  const data = await parseBody(res);
  return { res, data };
}
let refreshInFlight = null;
/**
 * Rotate the session, at most once at a time.
 *
 * The in-flight promise is shared, so a page that fires five requests and gets five 401s performs one
 * refresh and not five. That matters beyond efficiency: concurrent refreshes would present the same
 * rotated token more than once, which the backend treats as possible token theft and answers by
 * revoking the whole family.
 * @returns {Promise<boolean>} whether the session was refreshed
 */
export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const { res } = await send('/api/auth/refresh', { method: 'POST', body: {} });
        return res.ok;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}
/**
 * Make an API call, with automatic session recovery.
 *
 * A successful response resolves to its parsed body (`undefined` for 204). Anything else throws an
 * `ApiError`.
 *
 * A 401 on a protected endpoint is the interesting path: one shared refresh is attempted, and on
 * success the original request is retried exactly once — bounded, so a persistently failing endpoint
 * cannot loop. If the refresh fails, `expired` is dispatched so the app can return to the login page,
 * and the original 401 is thrown.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal, retryOn401?: boolean }} [options]
 * @returns {Promise<unknown>} the parsed response body
 * @throws {ApiError} for any non-2xx response
 */
export async function apiRequest(path, options = {}) {
  const { retryOn401 = true, ...init } = options;
  const first = await send(path, init);
  if (first.res.ok) {
    return first.data;
  }
  if (first.res.status === 401 && retryOn401 && !NO_REFRESH_PATHS.has(path)) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const second = await send(path, init);
      if (second.res.ok) {
        return second.data;
      }
      throw toApiError(second.res, second.data);
    }
    sessionEvents.dispatchEvent(new Event('expired'));
  }
  throw toApiError(first.res, first.data);
}
/**
 * Is this an `ApiError` (as opposed to a network failure or a programming error)?
 * @param {unknown} err
 * @returns {boolean}
 */
export function isApiError(err) {
  return err instanceof ApiError;
}
/**
 * A message safe to display for any thrown value.
 *
 * Used by ErrorState. Falls back to generic text so a thrown non-Error, or an Error with no message,
 * still renders something sensible instead of "undefined".
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Something went wrong';
}

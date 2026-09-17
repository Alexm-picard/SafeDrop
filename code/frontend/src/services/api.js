// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: the single fetch wrapper: credentials, JSON only, typed ApiError, one single-flight refresh + one retry on 401 (SDD §2.3.1, §6.3)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// This is the ONLY module in the SPA allowed to call fetch (ESLint enforces it for components,
// pages, hooks and context).
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
  /** Field-level messages keyed by field path, when the API returned validation details. */
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
/** Fired (as 'expired') when a 401 could not be recovered by refreshing; AuthProvider listens. */
export const sessionEvents = new EventTarget();
/** Endpoints where a 401 is the answer, never something to refresh around. */
const NO_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/organizations',
]);
function baseUrl() {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured) {
    return configured;
  }
  // Same origin: the Vite dev proxy / Vercel rewrite forwards /api/* to the API (OD-1 Option A).
  return typeof window !== 'undefined' ? window.location.origin : '';
}
export function resolveUrl(path) {
  return new URL(path, baseUrl()).toString();
}
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
function isErrorBody(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}
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
 * Rotate the session once, shared by every caller that hits a 401 at the same time, so a page with
 * several requests in flight never fires several refreshes.
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
 * Perform an API call. Resolves with the parsed JSON body (undefined for 204), throws ApiError for
 * any non-2xx response. A 401 on a protected endpoint triggers one refresh and one retry.
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
export function isApiError(err) {
  return err instanceof ApiError;
}
/** Human-readable message for any thrown value, for ErrorState. */
export function errorMessage(err) {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Something went wrong';
}

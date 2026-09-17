// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/requests/* (Sprint 1: the API answers 501 until SCRUM-requests-*)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { apiRequest } from './api';
const path = (id, action) => `/api/requests/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
export const list = (params = {}, signal) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return apiRequest(`/api/requests${qs ? `?${qs}` : ''}`, { signal });
};
export const get = (id, signal) => apiRequest(path(id), { signal });
export const create = (input) => apiRequest('/api/requests', { method: 'POST', body: input });
export const approve = (id, note = '') =>
  apiRequest(path(id, 'approve'), { method: 'POST', body: { note } });
export const deny = (id, note = '') =>
  apiRequest(path(id, 'deny'), { method: 'POST', body: { note } });
export const cancel = (id) => apiRequest(path(id, 'cancel'), { method: 'POST', body: {} });
export const checkout = (id) => apiRequest(path(id, 'checkout'), { method: 'POST', body: {} });
export const returnUnit = (id, input = {}) =>
  apiRequest(path(id, 'return'), { method: 'POST', body: input });

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/assets/* (Sprint 1: the API answers 501 until SCRUM-assets-*)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { apiRequest } from './api';
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
export const list = (params = {}, signal) => apiRequest(`/api/assets${query(params)}`, { signal });
export const get = (id, signal) => apiRequest(`/api/assets/${encodeURIComponent(id)}`, { signal });
export const create = (input) => apiRequest('/api/assets', { method: 'POST', body: input });
export const update = (id, patch) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
export const retire = (id) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/retire`, { method: 'POST', body: {} });
export const addUnit = (id, input) =>
  apiRequest(`/api/assets/${encodeURIComponent(id)}/units`, {
    method: 'POST',
    body: input,
  });

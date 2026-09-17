// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed calls for /api/auth/* (SCRUM-102)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { apiRequest } from './api';
export const login = (credentials) =>
  apiRequest('/api/auth/login', {
    method: 'POST',
    body: credentials,
    retryOn401: false,
  });
export const logout = () =>
  apiRequest('/api/auth/logout', { method: 'POST', body: {}, retryOn401: false });
export const refresh = () =>
  apiRequest('/api/auth/refresh', { method: 'POST', body: {}, retryOn401: false });
export const me = (signal) => apiRequest('/api/auth/me', { signal });

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed call for GET /api/dashboard/summary (SCRUM-103)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { apiRequest } from './api';
export const summary = (signal) => apiRequest('/api/dashboard/summary', { signal });

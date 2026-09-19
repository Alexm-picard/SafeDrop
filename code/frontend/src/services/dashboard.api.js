// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed call for GET /api/dashboard/summary (SCRUM-103)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Dashboard summary endpoint (ORG_ADMIN only).
 */
import { apiRequest } from './api';
/**
 * Read the organisation's summary counts.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ totalAssets: number, checkedOut: number, available: number, held: number, retired: number }>}
 */
export const summary = (signal) => apiRequest('/api/dashboard/summary', { signal });

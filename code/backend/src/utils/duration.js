// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: duration string parsing shared by env validation and token lifetimes
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Compact duration strings ("15m", "12h", "30s") and their conversion to milliseconds.
 *
 * Token lifetimes are configured as human-readable strings in the environment; `DURATION_PATTERN`
 * lets the env schema reject a malformed one at boot, and `durationToMs` converts it wherever a
 * number of milliseconds is actually needed (JWT expiry, refresh-token windows, cookie max-age).
 */
const UNITS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

/**
 * Parse a compact duration such as "15m", "12h" or "30s" into milliseconds.
 * @param {string} value
 * @returns {number}
 */
export function durationToMs(value) {
  const match = DURATION_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new TypeError(`Invalid duration "${value}" (expected e.g. 15m, 12h, 30s)`);
  }
  return Number(match[1]) * UNITS[match[2]];
}

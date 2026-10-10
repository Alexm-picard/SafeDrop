// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100%
// AI-Assisted Areas: shared pill badge for request states and unit statuses (UI rework)
// Human Contributions: reviewed and approved by Alex Picard (PR #62, 2026-10-04); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

import { humanize } from '../utils/format';
import { REQUEST_STATE_TONE, UNIT_STATUS_TONE } from '../utils/statusTone';

/**
 * A request state or unit status as a pill: the humanised word, tinted by what it asks of someone.
 *
 * The word is always present, so the tint is never the only signal (WCAG 1.4.1, NFR-12).
 * @param {{ value: string, kind?: 'request'|'unit', children?: React.ReactNode }} props
 *   `children`, when given, replaces the humanised label (e.g. "Approved (automatic)").
 * @returns {JSX.Element}
 */
export function StatusBadge({ value, kind = 'request', children }) {
  const tones = kind === 'unit' ? UNIT_STATUS_TONE : REQUEST_STATE_TONE;
  return (
    <span className="badge" data-tone={tones[value] ?? 'neutral'}>
      {children ?? humanize(value)}
    </span>
  );
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: small display formatters
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat('en-US');
/** "Sep 16, 2026, 7:00 PM" or "—" for missing/invalid input. */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}
export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormatter.format(value) : '—';
}
/** "1 asset" / "3 assets" */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
/** "ORG_ADMIN" → "Org admin"; "CHECKED_OUT" → "Checked out" */
export function humanize(value) {
  const words = value.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: a person's initials in a ring coloured by their role
// Human Contributions: reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL

/**
 * A person's initials in a circle, ringed in their role's colour. Decorative: the name always sits
 * beside it in text, so it is hidden from assistive technology.
 * @param {{ name: string, role?: string, size?: 'sm'|'md'|'lg' }} props
 * @returns {JSX.Element}
 */
export function Avatar({ name, role, size = 'md' }) {
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" data-size={size} data-role={role} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

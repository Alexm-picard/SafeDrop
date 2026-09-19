// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: URL-safe slug derivation shared by validation and the organisation service
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Derivation of URL-safe organisation slugs.
 *
 * An organisation is addressed by a slug at login (`orgSlug` + email + password), so the slug has
 * to be predictable, lowercase and safe in a URL. Both the request validation layer and the
 * organisation service derive it here so that the value a user is shown is the value that gets
 * stored.
 */

/**
 * Convert a display name into a URL-safe slug: `"Acme Robotics!"` → `"acme-robotics"`.
 *
 * Accents are stripped via NFKD normalisation, any run of non-alphanumerics becomes a single
 * hyphen, and the result is trimmed of leading/trailing hyphens and capped at 64 characters
 * (trimming again afterwards, so a cut that lands on a hyphen cannot leave a trailing one).
 * @param {string} name display name to convert
 * @returns {string} the slug, or `''` when nothing URL-safe remains (the caller must reject that)
 */
export function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

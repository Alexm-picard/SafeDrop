// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-122)
// AI-Assisted Areas: labelled form control with an accessible field-level error message
// Human Contributions: pending team review
// Notes: Generalises the field markup written inline in OrgSetupPage and MembersPage. Verified by
// tests/unit/components/primitives.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * One labelled form control and its error message.
 *
 * The asset forms have four, five and three fields respectively, and each needs the same three things
 * wired together correctly: a `<label>` bound to the control by id, `aria-invalid` when the server
 * rejected it, and `aria-describedby` pointing at the message so a screen reader reads the problem
 * with the field rather than leaving it stranded elsewhere on the page. Getting that wrong is easy
 * and invisible in a browser, so it is written once here.
 */

/**
 * Render a labelled control with its error.
 *
 * `children` is the control itself rather than a `type` prop, because the callers need inputs,
 * textareas and selects, and passing the element through keeps this component from growing a branch
 * per control type. The control is cloned only in the sense that the caller is handed the ids to
 * apply: `controlProps` returns what the control must spread, which keeps the wiring in one place
 * without this component reaching into its child.
 * @param {{ id: string, label: string, error?: string, hint?: string, children: (props: object) => React.ReactNode }} props
 * @returns {JSX.Element}
 */
export function FormField({ id, label, error, hint, children }) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint ? (
        <span id={hintId} className="hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="field-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

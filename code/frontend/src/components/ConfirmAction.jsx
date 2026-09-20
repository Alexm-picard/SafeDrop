// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code for SCRUM-122)
// AI-Assisted Areas: two-step confirmation for a destructive action, without a modal dialog
// Human Contributions: pending team review
// Notes: Verified by tests/unit/components/AssetDetailPage.test.jsx (the retire confirmation). Must
// be reviewed by the owning team member before merge.

import { useState } from 'react';

/**
 * A destructive action that asks before it acts.
 *
 * Retiring an asset is a soft delete, but it is still the kind of thing an admin should not be able
 * to do by mis-clicking one button, so the first press only *arms* the action and a second, clearly
 * labelled press performs it.
 *
 * This is deliberately not a modal dialog. A real modal has to trap focus, restore it on close, and
 * handle Escape — all of which is easy to get subtly wrong — and it would be the only one in the
 * product. Revealing the confirmation inline keeps the page's focus order intact: the confirm button
 * appears immediately after the trigger in the DOM, so Tab reaches it next.
 *
 * The prompt is announced through `role="alert"` so a screen reader hears what is about to happen
 * rather than silently gaining two new buttons.
 */

/**
 * Render a trigger that reveals a confirm/cancel pair when pressed.
 *
 * `onConfirm` may be async; while it is running both buttons are disabled and the confirm button
 * shows `pendingLabel`, so the action cannot be submitted twice. The confirmation collapses once it
 * resolves — on success because the caller has moved on, and on failure so the error the caller
 * renders is not competing with a live prompt.
 * @param {{ label: string, prompt: string, confirmLabel: string, pendingLabel?: string, onConfirm: () => Promise<void>|void, disabled?: boolean }} props
 * @returns {JSX.Element}
 */
export function ConfirmAction({
  label,
  prompt,
  confirmLabel,
  pendingLabel = 'Working…',
  onConfirm,
  disabled = false,
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setArmed(false);
    }
  };

  if (!armed) {
    return (
      <button type="button" className="danger" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm" role="alert">
      <p>{prompt}</p>
      <div className="actions">
        <button type="button" className="danger" disabled={pending} onClick={confirm}>
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={() => setArmed(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

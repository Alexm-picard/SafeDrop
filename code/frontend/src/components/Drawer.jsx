// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: the side panel that holds a page's secondary forms (invite, reset a password, create a group)
// Human Contributions: pending team review

/**
 * A side panel: a modal dialog that slides in from the right edge, with a pegboard header.
 *
 * It behaves like a dialog because it is one: `aria-modal`, labelled by its heading, focus moved into
 * it on open (the first field, or the Close button), kept inside it with Tab, and returned to whatever
 * opened it on close. Escape, the Close button and a click on the dimmed page all close it.
 *
 * Rendered only while open, so the form inside it starts fresh each time and a password typed into
 * it does not outlive the panel.
 */
import { useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Render the panel.
 * @param {{ title: string, description?: string, onClose: () => void, children: React.ReactNode }} props
 * @returns {JSX.Element}
 */
export function Drawer({ title, description, onClose, children }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const first =
      panel?.querySelector('.drawer-body input:not([type="checkbox"]):not([type="radio"])') ??
      panel?.querySelector('.drawer-close');
    first?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <>
      {/* The dimmed page closes the panel on a pointer press; the keyboard way out is Escape. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="drawer-back" onMouseDown={onClose} />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="drawer-head">
          <button type="button" className="secondary small drawer-close" onClick={onClose}>
            Close
          </button>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

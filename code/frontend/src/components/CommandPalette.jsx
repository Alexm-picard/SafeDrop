// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~95%
// AI-Assisted Areas: SCRUM-241 redesign: the ⌘K "jump to" palette (pages for the viewer's role and every asset in the catalog)
// Human Contributions: pending team review
// Notes: Navigation only. It offers the same pages as the rail, filtered by the same role rules, so it never shows a page the viewer cannot open.

/**
 * A keyboard-first way to get anywhere: type part of a page's or an asset's name, move with the
 * arrow keys, open with Enter, close with Escape.
 *
 * It is a modal dialog with a combobox and a listbox (the WAI-ARIA combobox pattern with
 * `aria-activedescendant`), so focus stays in the input while the highlighted option changes, and
 * focus goes back to whatever opened it when it closes.
 *
 * Assets come from one catalogue page of up to 100, the API's largest — enough for a jump list; the
 * catalogue page is where a longer inventory is searched.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAssets } from '../hooks/useAssets';
import { ROLES, ROUTES } from '../utils/constants';

const ASSET_PARAMS = Object.freeze({ limit: 100 });

/**
 * The pages this role may open, in the rail's order.
 * @param {string|undefined} role
 * @returns {{ label: string, hint: string, to: string }[]}
 */
function pagesFor(role) {
  const canApprove = role === ROLES.APPROVER || role === ROLES.ORG_ADMIN;
  const isAdmin = role === ROLES.ORG_ADMIN;
  return [
    isAdmin && { label: 'Overview', hint: 'Page', to: ROUTES.admin },
    { label: 'Catalog', hint: 'Page', to: ROUTES.catalog },
    canApprove && { label: 'Requests', hint: 'Page', to: ROUTES.approvals },
    { label: 'My requests', hint: 'Page', to: ROUTES.myRequests },
    isAdmin && { label: 'New asset', hint: 'Action', to: ROUTES.assetNew },
    isAdmin && { label: 'Users', hint: 'Page', to: ROUTES.users },
    isAdmin && { label: 'Groups', hint: 'Page', to: ROUTES.groups },
    isAdmin && { label: 'Audit log', hint: 'Page', to: ROUTES.auditLog },
    isAdmin && { label: 'Settings', hint: 'Page', to: ROUTES.settings },
    { label: 'Change password', hint: 'Page', to: ROUTES.changePassword },
  ].filter(Boolean);
}

/**
 * Render the palette.
 * @param {{ role: string|undefined, onClose: () => void }} props
 * @returns {JSX.Element}
 */
export function CommandPalette({ role, onClose }) {
  const navigate = useNavigate();
  const { data } = useAssets(ASSET_PARAMS);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();

  const items = useMemo(() => {
    const assets = (data?.items ?? []).map((a) => ({
      label: a.name,
      hint: 'Asset',
      to: ROUTES.asset(a.id),
    }));
    const all = [...pagesFor(role), ...assets];
    const q = query.trim().toLowerCase();
    return q ? all.filter((item) => item.label.toLowerCase().includes(q)) : all;
  }, [data, query, role]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  // Focus the input on open and give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  // Keep the highlighted option in view as the arrow keys move through a long list.
  useEffect(() => {
    document.getElementById(`${listId}-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current, listId]);

  const open = (item) => {
    onClose();
    navigate(item.to);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(current + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && items[current]) {
      event.preventDefault();
      open(items[current]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    // The backdrop closes the palette on a pointer press outside it; the keyboard way out is Escape,
    // handled on the input, so the backdrop needs no key handler of its own.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="palette-back"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search or jump to">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `${listId}-${current}` : undefined}
          aria-label="Search or jump to"
          placeholder="Type a page or an asset"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Matches">
          {items.length === 0 ? (
            <li className="palette-empty" role="presentation">
              Nothing matches “{query.trim()}”.
            </li>
          ) : (
            items.map((item, i) => (
              // Options are chosen with the keyboard through the combobox, so the pointer handler is
              // the only one each option needs.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={`${item.hint}-${item.to}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setActive(i)}
                onClick={() => open(item)}
              >
                {item.label}
                <span>{item.hint}</span>
              </li>
            ))
          )}
        </ul>
        <p className="palette-foot" aria-hidden="true">
          <span>↑ ↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </p>
      </div>
    </div>
  );
}

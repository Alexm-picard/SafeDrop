// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed accessible table stub for catalogue/request/audit lists; UI rework: hidden caption, column classes, optional client-side paging
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

import { usePagination } from '../hooks/usePagination';
import { Pagination } from './Pagination';

/**
 * The shared table used by every list screen.
 *
 * A column-driven table rather than hand-written markup per page, so the semantics that make it
 * readable to a screen reader — a caption, `scope="col"` headers, a real `<table>` — are written once
 * and cannot be forgotten on a new list.
 */

/**
 * Render rows against a column definition.
 *
 * Each column supplies its own `render(row)`, so formatting stays with the page that knows what the
 * data means while the markup stays here. An empty result renders a hint instead of an empty grid,
 * which reads as "nothing here" rather than as a broken table.
 *
 * `hideCaption` keeps the caption for assistive technology but hides it on screen, for a table that
 * sits inside a panel whose own heading already names it. A column may carry a `className` for its
 * header and cells (e.g. `numeric`).
 *
 * `pageSize` pages a long list on the client, ten rows at a time by default when set, with the
 * controls beneath the table; `pageLabel` names that control. Without it every row renders.
 *
 * `getRowId` is required rather than falling back to the array index: with an index key, React reuses
 * DOM nodes across re-sorts and re-fetches and rows end up showing each other's content.
 * @param {{ caption: string, hideCaption?: boolean, pageSize?: number, pageLabel?: string, columns: Array<{ key: string, header: string, className?: string, render: (row: object) => React.ReactNode }>, rows: object[], getRowId: (row: object) => string, emptyMessage?: string }} props
 * @returns {JSX.Element}
 */
export function DataTable({
  caption,
  hideCaption = false,
  pageSize,
  pageLabel,
  columns,
  rows,
  getRowId,
  emptyMessage = 'Nothing to show yet.',
}) {
  const { pageItems, page, pageCount, setPage } = usePagination(rows, pageSize ?? Infinity);
  if (rows.length === 0) {
    return <p className="hint">{emptyMessage}</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table>
          <caption className={hideCaption ? 'visually-hidden' : undefined}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={column.className}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((row) => (
              <tr key={getRowId(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageCount={pageCount}
        onChange={setPage}
        label={pageLabel ?? `${caption} pages`}
      />
    </>
  );
}

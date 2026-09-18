// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed accessible table stub for catalogue/request/audit lists
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 * `getRowId` is required rather than falling back to the array index: with an index key, React reuses
 * DOM nodes across re-sorts and re-fetches and rows end up showing each other's content.
 * @param {{ caption: string, columns: Array<{ key: string, header: string, render: (row: object) => React.ReactNode }>, rows: object[], getRowId: (row: object) => string, emptyMessage?: string }} props
 * @returns {JSX.Element}
 */
export function DataTable({
  caption,
  columns,
  rows,
  getRowId,
  emptyMessage = 'Nothing to show yet.',
}) {
  if (rows.length === 0) {
    return <p className="hint">{emptyMessage}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowId(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

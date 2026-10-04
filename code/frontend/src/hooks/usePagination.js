// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100%
// AI-Assisted Areas: client-side paging for lists already loaded in full (UI rework)
// Human Contributions: pending team review

import { useState } from 'react';

/** How many rows a paged panel shows at once, unless the caller asks for another size. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Page through a list the page already holds in full (an asset's units, a group's members).
 *
 * For lists the API pages itself (the audit log, an asset's history) use the API's pagination
 * instead; this only keeps a long in-memory list from stretching its panel down the screen.
 *
 * The page is clamped to the last one that exists, so removing the only row on the final page lands
 * on the page before rather than on an empty one.
 * @template T
 * @param {T[]} items
 * @param {number} [pageSize]
 * @returns {{ pageItems: T[], page: number, pageCount: number, setPage: (page: number) => void }}
 */
export function usePagination(items, pageSize = DEFAULT_PAGE_SIZE) {
  const [requested, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requested), pageCount);
  // An unbounded page size (`Infinity`, for "do not page") would make the start index 0 × Infinity,
  // which is NaN, so that case returns the list whole.
  if (!Number.isFinite(pageSize)) {
    return { pageItems: items, page: 1, pageCount: 1, setPage };
  }
  const start = (page - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), page, pageCount, setPage };
}

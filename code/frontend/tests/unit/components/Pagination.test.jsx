// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100%
// AI-Assisted Areas: DataTable client-side paging and the usePagination clamp (UI rework)
// Human Contributions: pending team review

/**
 * Tests for paging a long in-memory list (DataTable `pageSize`, usePagination).
 */
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataTable } from '../../../src/components/DataTable';
import { usePagination } from '../../../src/hooks/usePagination';

const rows = Array.from({ length: 23 }, (_, i) => ({ id: String(i + 1), name: `Unit ${i + 1}` }));
const columns = [{ key: 'name', header: 'Name', render: (r) => r.name }];

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('DataTable paging', () => {
  it('shows one page at a time and steps through the rest', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        caption="Units"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        pageSize={10}
      />,
    );
    expect(bodyRows()).toHaveLength(10);
    const nav = screen.getByRole('navigation', { name: 'Units pages' });
    expect(nav).toHaveTextContent('Page 1 of 3');
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(within(nav).getByRole('button', { name: 'Next' }));
    await user.click(within(nav).getByRole('button', { name: 'Next' }));
    expect(nav).toHaveTextContent('Page 3 of 3');
    expect(bodyRows()).toHaveLength(3);
    expect(within(nav).getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows no controls when everything fits, and every row without a page size', () => {
    const { rerender } = render(
      <DataTable
        caption="Units"
        columns={columns}
        rows={rows.slice(0, 4)}
        getRowId={(r) => r.id}
        pageSize={10}
      />,
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    rerender(<DataTable caption="Units" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(bodyRows()).toHaveLength(23);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('usePagination', () => {
  it('falls back to the last page that still exists when the list shrinks', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 10), {
      initialProps: { items: rows },
    });
    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toHaveLength(3);
    rerender({ items: rows.slice(0, 15) });
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toHaveLength(5);
  });
});

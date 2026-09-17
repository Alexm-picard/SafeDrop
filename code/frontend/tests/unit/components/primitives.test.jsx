// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: ErrorState, LoadingState, DataTable, TicketPlaceholder, NotFoundPage tests
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '../../../src/components/DataTable';
import { ErrorState } from '../../../src/components/ErrorState';
import { LoadingState } from '../../../src/components/LoadingState';
import { TicketPlaceholder } from '../../../src/components/TicketPlaceholder';
import { NotFoundPage } from '../../../src/pages/NotFoundPage';
import { ApiError } from '../../../src/services/api';
describe('LoadingState', () => {
  it('is a polite live region', () => {
    render(<LoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loading…');
  });
});
describe('ErrorState', () => {
  it('renders an alert with the message, code, request id, ticket and retry', async () => {
    const onRetry = vi.fn();
    const err = new ApiError(501, 'NOT_IMPLEMENTED', 'Not yet', { ticket: 'SCRUM-1' }, 'req-9');
    render(<ErrorState error={err} onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Not yet');
    expect(alert).toHaveTextContent('SCRUM-1');
    expect(alert).toHaveTextContent('NOT_IMPLEMENTED · HTTP 501 · request req-9');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it('handles plain errors and unknown values', () => {
    render(<ErrorState error={new Error('network down')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    render(<ErrorState error={undefined} title="Oops" />);
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('Something went wrong');
  });
});
describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'id', header: 'Id', render: (r) => r.id },
  ];
  it('renders an accessible table', () => {
    render(
      <DataTable
        caption="Things"
        columns={columns}
        rows={[
          { id: '1', name: 'One' },
          { id: '2', name: 'Two' },
        ]}
        getRowId={(r) => r.id}
      />,
    );
    const table = screen.getByRole('table', { name: 'Things' });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Id']);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'Two' })).toBeInTheDocument();
  });
  it('renders the empty message without a table', () => {
    render(
      <DataTable
        caption="Things"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
describe('TicketPlaceholder and NotFoundPage', () => {
  it('names the owning ticket', () => {
    render(<TicketPlaceholder ticket="SCRUM-42">Soon.</TicketPlaceholder>);
    expect(screen.getByText('SCRUM-42')).toBeInTheDocument();
    expect(screen.getByText('Soon.')).toBeInTheDocument();
  });
  it('404 links home', () => {
    const router = createMemoryRouter([{ path: '*', element: <NotFoundPage /> }], {
      initialEntries: ['/nope'],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(screen.getByRole('link', { name: /catalog/i })).toHaveAttribute('href', '/');
  });
});

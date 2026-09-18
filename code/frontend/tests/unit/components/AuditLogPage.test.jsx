/**
 * Tests for the audit log page (SCRUM-53, covering SCRUM-51).
 *
 * Several of these assert on the *request* the page makes rather than only on what it renders, because
 * filtering and paging happen server-side: a filter that never reaches the query string would still
 * look plausible on screen while quietly showing the wrong rows.
 *
 * The date-boundary test is the one worth keeping if any are ever trimmed. A date input yields
 * `"2026-09-18"`, which `new Date()` reads as UTC midnight, so sending it unmodified as `to` would
 * exclude everything that happened during the day the user picked — an audit tool dropping the most
 * recent events is the worst way for this screen to be wrong, and it is invisible without this test.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogPage } from '../../../src/pages/AuditLogPage';
import { adminUser, auditEvents, auditPage, errorResponse } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { renderWithAuth } from '../../utils/render';
/** Query strings the page has sent, oldest first, so a test can assert on what it actually asked for. */
let requests = [];
beforeEach(() => {
  requests = [];
  server.use(
    http.get('*/api/audit', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.searchParams);
      return HttpResponse.json(auditPage(url.searchParams));
    }),
  );
});
/** The parameters of the most recent audit request. */
const lastRequest = () => requests[requests.length - 1];
/** Data rows currently rendered, excluding the header row. */
const dataRows = () => screen.getAllByRole('row').slice(1);
describe('AuditLogPage', () => {
  it('shows a loading state, then a page of events newest first', async () => {
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(25);
    expect(screen.getByRole('status')).toHaveTextContent('30 events');
    // The newest fixture event is first, and its action is humanised rather than shown raw.
    const first = within(dataRows()[0]);
    expect(first.getByText('Asset checked out')).toBeInTheDocument();
    expect(first.getByText(auditEvents[0].targetId)).toBeInTheDocument();
    expect(screen.queryByText('ASSET_CHECKED_OUT')).not.toBeInTheDocument();
  });
  it('states in the caption that the record cannot be edited, and offers no way to change it', async () => {
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    expect(await screen.findByRole('table')).toHaveTextContent(/cannot be edited/i);
    // SR-8: the API exposes no mutation, so neither may the screen.
    for (const label of [/edit/i, /delete/i, /remove/i, /save/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
  it('sends the selected action as a filter and narrows the table', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Action'), 'REQUEST_APPROVED');
    await screen.findByText('10 events matching the filters');
    expect(lastRequest().get('action')).toBe('REQUEST_APPROVED');
    expect(dataRows()).toHaveLength(10);
  });
  it('leaves an unset filter out of the query string entirely', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    // An empty `?action=` fails the route's Zod enum and returns 400, so it must be absent, not blank.
    expect(lastRequest().has('action')).toBe(false);
    expect(lastRequest().has('targetType')).toBe(false);
    await user.selectOptions(screen.getByLabelText('Action'), 'REQUEST_APPROVED');
    await screen.findByText('10 events matching the filters');
    await user.selectOptions(screen.getByLabelText('Action'), '');
    await screen.findByText('30 events');
    expect(lastRequest().has('action')).toBe(false);
  });
  it('sends a date range covering the whole of both days the user picked', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('From'), '2026-09-01');
    await user.type(screen.getByLabelText('To'), '2026-09-18');
    await screen.findByText(/matching the filters/);
    // Both sides build the instant from a local-time string, so the assertion holds in any timezone.
    expect(lastRequest().get('from')).toBe(new Date('2026-09-01T00:00:00.000').toISOString());
    expect(lastRequest().get('to')).toBe(new Date('2026-09-18T23:59:59.999').toISOString());
  });
  it('pages through the trail and stops at the last page', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    const pager = screen.getByRole('navigation', { name: 'Audit log pages' });
    expect(within(pager).getByText('Page 1 of 2')).toBeInTheDocument();
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(within(pager).getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect(lastRequest().get('page')).toBe('2');
    expect(dataRows()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 1 of 2');
    expect(lastRequest().get('page')).toBe('1');
    expect(dataRows()).toHaveLength(25);
  });
  it('does not navigate when a filter field is submitted with Enter', async () => {
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    // Filters apply as they change, so a submit has nothing to do; letting it through would reload
    // the SPA and throw away the session bootstrap.
    const form = screen.getByRole('form', { name: 'Filter audit events' });
    expect(fireEvent.submit(form)).toBe(false);
  });
  it('returns to page 1 when a filter changes', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    // Without the reset this would request page 2 of a 10-row result and render an empty table.
    await user.selectOptions(screen.getByLabelText('Action'), 'REQUEST_APPROVED');
    await screen.findByText('10 events matching the filters');
    expect(lastRequest().get('page')).toBe('1');
    expect(dataRows()).toHaveLength(10);
  });
  it('clears every filter at once and hides the clear button when none are set', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Action'), 'REQUEST_APPROVED');
    await user.selectOptions(screen.getByLabelText('Target'), 'CheckoutRequest');
    await screen.findByText('10 events matching the filters');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('30 events');
    expect(lastRequest().has('action')).toBe(false);
    expect(lastRequest().has('targetType')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
  it('explains an empty result differently when filters are to blame', async () => {
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    await screen.findByRole('table');
    // No fixture pairs this action with this target, so the combination matches nothing.
    await user.selectOptions(screen.getByLabelText('Action'), 'REQUEST_APPROVED');
    await user.selectOptions(screen.getByLabelText('Target'), 'AssetUnit');
    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('says the log is empty rather than blaming filters when there is nothing recorded', async () => {
    server.use(
      http.get('*/api/audit', () => HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 })),
    );
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    expect(await screen.findByText('No activity has been recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Audit log pages' })).not.toBeInTheDocument();
  });
  it('renders ErrorState when the API fails and retries on demand', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/audit', ({ request }) => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong')
          : HttpResponse.json(auditPage(new URL(request.url).searchParams));
      }),
    );
    const user = userEvent.setup();
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the audit log');
    expect(alert).toHaveTextContent('INTERNAL_ERROR');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
  it('surfaces the API rejection when the viewer lacks audit:read', async () => {
    server.use(
      http.get('*/api/audit', () =>
        errorResponse(403, 'FORBIDDEN', 'You do not have permission to do that'),
      ),
    );
    renderWithAuth(<AuditLogPage />, { user: adminUser });
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

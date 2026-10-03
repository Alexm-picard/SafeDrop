// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: asset detail page wired to useAsset, showing its units and their statuses; SCRUM-148 approval row and auto-approved notice; SCRUM-150 Restricted badge and disabled Request button for an ineligible caller, also when every group was deleted (SCRUM-203); UI rework: page header with actions, details panel, units panel beside the add-unit form, status badges
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * One asset and its units.
 *
 * Reached from the catalogue. SCRUM-115: shows every unit's tag, status and condition, so a member
 * can see what is actually available before requesting one.
 *
 * SCRUM-124 adds the requesting itself, which is why this page is the entry point to the borrowing
 * loop: the choice it supports — which of these units, for when — is made while looking at the table
 * of units, so "Request this" sits in the row and the date form opens beneath the table rather than
 * on a screen of its own. It is offered on AVAILABLE units only, and not at all for a retired asset.
 * Every role holds `requests:create`, so it is not role-gated — an approver borrows things too.
 *
 * SCRUM-122 hangs the admin actions off this page: edit, retire, and add a unit. They are rendered
 * only for an ORG_ADMIN, which is a usability choice and not a security control — `assets:write` is
 * enforced by the API on every one of those routes (SR-1), so a member who reaches them another way
 * gets a 403 rather than an effect.
 *
 * Retiring is a soft delete: the asset keeps its units and its history, and the page stays readable
 * afterwards with a banner saying it is retired. That is why the action is "Retire" and not "Delete",
 * and why the page does not navigate away when it succeeds.
 *
 * SCRUM-141 adds maintenance to the unit rows: an admin sends one physical unit for repair and brings
 * it back, from the row it is in. Unlike retiring, it is reversible by the button beside it, so it
 * takes no confirmation step. It is the per-unit counterpart to retiring the whole asset — which is
 * why it belongs in the table rather than in the page-level actions.
 *
 * SCRUM-150 (AT-4) marks restricted equipment. A restricted asset shows a Restricted badge; when the
 * API reports the caller is not `eligible`, the page names the groups that may request it and
 * disables every Request button, pointing each one at that sentence. Roles do not bypass it — an
 * admin outside the groups sees the same thing. This is usability only: the API refuses an
 * ineligible request regardless (AT-1).
 */
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AddUnitForm } from '../components/AddUnitForm';
import { AssetHistory } from '../components/AssetHistory';
import { ConfirmAction } from '../components/ConfirmAction';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { RequestUnitForm } from '../components/RequestUnitForm';
import { RestrictedBadge } from '../components/RestrictedBadge';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../hooks/useAuth';
import { useAsset } from '../hooks/useAssets';
import { errorMessage } from '../services/api';
import * as assetsApi from '../services/assets.api';
import { assetApprovalLabel, ROLES, ROUTES, UNIT_STATUS } from '../utils/constants';
import { formatDate, humanize, pluralize, restrictionNote } from '../utils/format';
/**
 * Render one asset's details, keyed by the `:id` route parameter.
 *
 * The id defaults to an empty string so a malformed URL produces an ordinary failed request with an
 * error state, rather than a crash on an undefined parameter. The heading falls back to "Asset" until
 * the data arrives, so the page does not shift its title as it loads.
 *
 * `notice` is the page's single message area, carrying both what this page did (retired, unit added)
 * and what the form page did before redirecting here (created, updated) via the router's location
 * state. One area means one live region competing for a screen reader's attention.
 *
 * **The content stays on screen while it refreshes** — the gate is `data`, not `status === 'success'`
 * — following MembersPage. Every action here ends in `reload()`, and `reload()` sets the status back
 * to loading while keeping the data. Gating on the status would therefore unmount the table and the
 * request form mid-action, taking with them the error the form had just set and whatever had
 * keyboard focus. Only a genuine first load, with no data yet, shows the loading state.
 * @returns {JSX.Element}
 */
export function AssetDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { status, data, error, reload } = useAsset(id);
  const [notice, setNotice] = useState(
    location.state?.notice ? { tone: 'success', message: location.state.notice } : null,
  );
  const [requestingUnitId, setRequestingUnitId] = useState(null);
  // Which unit has a maintenance call in flight, so only that row's button goes disabled rather than
  // the whole table.
  const [maintainingUnitId, setMaintainingUnitId] = useState(null);

  const isAdmin = role === ROLES.ORG_ADMIN;
  const isRetired = Boolean(data?.retiredAt);
  // A retired asset is out of circulation, so its units are not requestable even while they still
  // read as AVAILABLE — the server would refuse, and offering the button would be a lie.
  const canRequest = !isRetired;
  // SCRUM-150: restricted to groups the caller is not in. Only an explicit `false` disables Request,
  // so a response without the field (an older API) behaves as before. `restricted` rather than the
  // number of names (SCRUM-203): an asset whose groups were all deleted has no names but is still
  // restricted, to nobody.
  const allowedGroups = data?.allowedGroups ?? [];
  const restricted = data?.restricted ?? allowedGroups.length > 0;
  const ineligible = restricted && data?.eligible === false;
  const requestingUnit = data?.units?.find((u) => u.id === requestingUnitId) ?? null;

  const onRetire = useCallback(async () => {
    setNotice(null);
    try {
      await assetsApi.retire(id);
      setNotice({
        tone: 'success',
        message: 'Asset retired. It no longer appears in the catalog.',
      });
      reload();
    } catch (err) {
      // The backend refuses while a unit is OUT or HELD. `errorMessage` surfaces that refusal's own
      // wording, which explains the reason, rather than the bare status code.
      setNotice({ tone: 'error', message: errorMessage(err) });
    }
  }, [id, reload]);

  /**
   * Send one unit for repair, or bring it back (SCRUM-141).
   *
   * No confirmation step, unlike retiring: this is reversible by the button next to it, and a
   * confirmation for an action you can undo in one click is noise. The refusals the server can raise
   * — the unit was taken in the meantime, or it is not actually available — arrive as the notice,
   * carrying the server's own wording rather than a status code, the same way `onRetire` does.
   * @param {object} unit the row's unit
   * @param {'start'|'end'} direction
   */
  const onMaintenance = useCallback(
    async (unit, direction) => {
      setNotice(null);
      setMaintainingUnitId(unit.id);
      try {
        if (direction === 'start') {
          await assetsApi.startMaintenance(id, unit.id);
          setNotice({
            tone: 'success',
            message: `Unit ${unit.tag} is now in maintenance and cannot be requested.`,
          });
        } else {
          await assetsApi.endMaintenance(id, unit.id);
          setNotice({ tone: 'success', message: `Unit ${unit.tag} is back in circulation.` });
        }
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setMaintainingUnitId(null);
      }
    },
    [id, reload],
  );

  const onUnitAdded = useCallback(
    (unit) => {
      setNotice({ tone: 'success', message: `Added unit ${unit?.tag ?? ''}.`.trim() });
      reload();
    },
    [reload],
  );

  // SCRUM-124. The new request's own page is the better destination than My requests: it is where
  // the state, the window and the cancel action live, so the member lands on what they just made
  // rather than on a list they have to find it in.
  const onRequested = useCallback(
    (created) => {
      setRequestingUnitId(null);
      navigate(ROUTES.request(created.id), {
        state: {
          // SCRUM-148: an auto-approved request skips the queue but not the handoff.
          notice:
            created.state === 'APPROVED'
              ? 'Request approved automatically. Collect the item in person; it is checked out at handoff.'
              : 'Request submitted. An approver will review it.',
        },
      });
    },
    [navigate],
  );

  const units = data?.units ?? [];
  const availableCount = units.filter((u) => u.status === UNIT_STATUS.AVAILABLE).length;

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">
            <Link to={ROUTES.catalog}>← Catalog</Link>
          </span>
          <h1>{data ? data.name : 'Asset'}</h1>
          {data && (restricted || isRetired) ? (
            <div className="badges">
              {restricted ? <RestrictedBadge allowedGroups={allowedGroups} restricted /> : null}
              {isRetired ? <StatusBadge value="RETIRED" kind="unit" /> : null}
            </div>
          ) : null}
        </div>
        {/* SCRUM-122: admin actions, beside the title they act on. */}
        {data && isAdmin ? (
          <div className="actions">
            <Link className="button secondary" to={ROUTES.assetEdit(id)}>
              Edit asset
            </Link>
            {isRetired ? null : (
              <ConfirmAction
                label="Retire asset"
                prompt={`Retire ${data.name}? It will stop appearing in the catalog. Its units and history are kept.`}
                confirmLabel="Yes, retire it"
                pendingLabel="Retiring…"
                onConfirm={onRetire}
              />
            )}
          </div>
        ) : null}
      </header>
      {status === 'loading' && !data ? <LoadingState label="Loading asset…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this asset" onRetry={reload} />
      ) : null}
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert alert--inline' : 'notice notice--inline'}
        >
          <p>{notice.message}</p>
          <button type="button" className="secondary small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {status !== 'error' && data ? (
        <>
          {ineligible ? (
            <p className="notice notice--warn" id="restriction-note">
              {restrictionNote(allowedGroups, { restricted: true })}. Ask your organization admin
              about access.
            </p>
          ) : null}
          {isRetired ? (
            <p className="notice notice--muted">
              This asset was retired {formatDate(data.retiredAt)} and no longer appears in the
              catalog.
            </p>
          ) : null}
          <section className="panel" aria-labelledby="details-heading">
            <div className="panel-header">
              <h2 id="details-heading">Details</h2>
            </div>
            <div className="panel-body">
              <dl className="details-grid">
                <div>
                  <dt>Category</dt>
                  <dd>{data.category}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {availableCount} of {pluralize(units.length, 'unit')} available
                  </dd>
                </div>
                {/* SCRUM-148: admins see the override they set; members learn the outcome on submit. */}
                {isAdmin ? (
                  <div>
                    <dt>Checkout approval</dt>
                    <dd>{assetApprovalLabel(data.approvalMode)}</dd>
                  </div>
                ) : null}
                {restricted ? (
                  <div>
                    <dt>Who can request</dt>
                    <dd>
                      {allowedGroups.length > 0
                        ? allowedGroups.map((g) => g.name).join(', ')
                        : 'Nobody (its groups were deleted)'}
                    </dd>
                  </div>
                ) : null}
                {data.description ? (
                  <div className="wide">
                    <dt>Description</dt>
                    <dd>{data.description}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>
          <div className={isAdmin && !isRetired ? 'split' : undefined}>
            <div className="stack">
              <section className="panel" aria-labelledby="units-heading">
                <div className="panel-header">
                  <h2 id="units-heading">Units</h2>
                  <span className="hint">
                    {availableCount} of {units.length} available
                  </span>
                </div>
                <DataTable
                  caption="Units"
                  hideCaption
                  pageSize={10}
                  columns={[
                    {
                      key: 'tag',
                      header: 'Tag',
                      render: (u) => <span className="tag">{u.tag}</span>,
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (u) => <StatusBadge value={u.status} kind="unit" />,
                    },
                    { key: 'condition', header: 'Condition', render: (u) => humanize(u.condition) },
                    {
                      key: 'request',
                      header: 'Request',
                      // Offered only on AVAILABLE units (SCRUM-124). Every role holds `requests:create`,
                      // so this is not role-gated — an approver borrows things too. The label carries the
                      // tag, because five identical "Request this" buttons are indistinguishable to
                      // anyone navigating by button name rather than by row.
                      render: (u) =>
                        canRequest && u.status === UNIT_STATUS.AVAILABLE ? (
                          <button
                            type="button"
                            className="small"
                            aria-label={`Request unit ${u.tag}`}
                            aria-describedby={ineligible ? 'restriction-note' : undefined}
                            disabled={ineligible || requestingUnitId === u.id}
                            onClick={() => setRequestingUnitId(u.id)}
                          >
                            Request this
                          </button>
                        ) : (
                          <span className="meta">—</span>
                        ),
                    },
                    // SCRUM-141. Admin-only and only while the asset is in circulation, mirroring the other
                    // admin controls: presentation, not security — the API enforces `assets:write` (SR-1).
                    // One action per row, whichever applies: AVAILABLE can go for repair, MAINTENANCE can
                    // come back, and anything else (OUT, HELD, REQUESTED, RETIRED) would be refused with a
                    // 409, so offering a button would be a lie. The label carries the tag, because several
                    // identical "Start maintenance" buttons are indistinguishable to anyone navigating by
                    // button name rather than by row.
                    ...(isAdmin && !isRetired
                      ? [
                          {
                            key: 'maintenance',
                            header: 'Maintenance',
                            render: (u) => {
                              const direction =
                                u.status === UNIT_STATUS.AVAILABLE
                                  ? 'start'
                                  : u.status === UNIT_STATUS.MAINTENANCE
                                    ? 'end'
                                    : null;
                              if (!direction) {
                                return <span className="meta">—</span>;
                              }
                              const label =
                                direction === 'start' ? 'Start maintenance' : 'End maintenance';
                              return (
                                <button
                                  type="button"
                                  className="secondary small"
                                  aria-label={`${label} for unit ${u.tag}`}
                                  disabled={maintainingUnitId === u.id}
                                  onClick={() => onMaintenance(u, direction)}
                                >
                                  {maintainingUnitId === u.id ? 'Working…' : label}
                                </button>
                              );
                            },
                          },
                        ]
                      : []),
                  ]}
                  rows={units}
                  getRowId={(u) => u.id}
                  emptyMessage="This asset has no units yet."
                />
              </section>
              {requestingUnit ? (
                <RequestUnitForm
                  unit={requestingUnit}
                  onCreated={onRequested}
                  onFailed={reload}
                  onCancel={() => setRequestingUnitId(null)}
                />
              ) : null}
            </div>
            {isAdmin && !isRetired ? (
              <div className="stack">
                <AddUnitForm assetId={id} onAdded={onUnitAdded} />
              </div>
            ) : null}
          </div>
          {/*
            SCRUM-29. Rendered for an admin only, and for a retired asset too: a retired laptop is
            exactly the one somebody asks about afterwards, so its history outlives its circulation.
            The role check here is usability — the API enforces `audit:read` itself (SR-1), and the
            component explains a 403 rather than failing, in case this is reached another way.
          */}
          {isAdmin ? <AssetHistory assetId={id} /> : null}
        </>
      ) : null}
    </>
  );
}

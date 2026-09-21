// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (drafted from team design documents to satisfy SCRUM-115's acceptance criteria)
// AI-Assisted Areas: asset detail page wired to useAsset, showing its units and their statuses
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
import { useAuth } from '../hooks/useAuth';
import { useAsset } from '../hooks/useAssets';
import { errorMessage } from '../services/api';
import * as assetsApi from '../services/assets.api';
import { ROLES, ROUTES, UNIT_STATUS } from '../utils/constants';
import { formatDate, humanize } from '../utils/format';
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

  const isAdmin = role === ROLES.ORG_ADMIN;
  const isRetired = Boolean(data?.retiredAt);
  // A retired asset is out of circulation, so its units are not requestable even while they still
  // read as AVAILABLE — the server would refuse, and offering the button would be a lie.
  const canRequest = !isRetired;
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
        state: { notice: 'Request submitted. An approver will review it.' },
      });
    },
    [navigate],
  );

  return (
    <>
      <h1>{data ? data.name : 'Asset'}</h1>
      {status === 'loading' && !data ? <LoadingState label="Loading asset…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this asset" onRetry={reload} />
      ) : null}
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert' : 'notice'}
        >
          <p>{notice.message}</p>
          <button type="button" className="secondary" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {status !== 'error' && data ? (
        <>
          {isRetired ? (
            <p className="notice">
              This asset was retired {formatDate(data.retiredAt)} and no longer appears in the
              catalog.
            </p>
          ) : null}
          {isAdmin ? (
            <div className="actions">
              <Link className="button" to={ROUTES.assetEdit(id)}>
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
          <dl>
            <dt>Category</dt>
            <dd>{data.category}</dd>
            {data.description ? (
              <>
                <dt>Description</dt>
                <dd>{data.description}</dd>
              </>
            ) : null}
          </dl>
          <DataTable
            caption="Units"
            columns={[
              { key: 'tag', header: 'Tag', render: (u) => u.tag },
              { key: 'status', header: 'Status', render: (u) => humanize(u.status) },
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
                      className="secondary"
                      aria-label={`Request unit ${u.tag}`}
                      disabled={requestingUnitId === u.id}
                      onClick={() => setRequestingUnitId(u.id)}
                    >
                      Request this
                    </button>
                  ) : (
                    <span className="meta">—</span>
                  ),
              },
            ]}
            rows={data.units}
            getRowId={(u) => u.id}
            emptyMessage="This asset has no units yet."
          />
          {requestingUnit ? (
            <RequestUnitForm
              unit={requestingUnit}
              onCreated={onRequested}
              onFailed={reload}
              onCancel={() => setRequestingUnitId(null)}
            />
          ) : null}
          {isAdmin && !isRetired ? <AddUnitForm assetId={id} onAdded={onUnitAdded} /> : null}
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

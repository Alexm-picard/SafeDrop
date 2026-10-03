// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-148 story)
// AI-Assisted Areas: organisation settings page with the approval default (REQUIRED / AUTO); SCRUM-205 pickup grace period and on-demand expiry
// Human Contributions: story, acceptance criteria and the "auto-approval still needs a handoff" decision by Orelmis Toribio; pending team review
// Notes: Follows the load/seed pattern in AssetFormPage. Verified by tests/unit/components/OrgSettingsPage.test.jsx.

/**
 * Organisation settings (ORG_ADMIN only, SCRUM-148).
 *
 * Today it holds one setting: whether checkout requests need an approver by default. Each asset can
 * override it from its own edit form, so the copy here says "by default" and points there.
 *
 * Two things the admin must not be surprised by, so the page says them:
 *
 * - **Not retroactive.** Requests already waiting stay in the approval queue; the new rule applies to
 *   requests submitted after saving.
 * - **Automatic approval is not automatic checkout.** The item is still handed over in person and
 *   recorded at handoff, so "approve automatically" only removes the wait for a decision.
 *
 * It also holds the pickup window (SCRUM-205): how many hours after the start of a request an approved
 * item may wait to be collected before the approval expires and the unit is freed. There is no
 * scheduler yet, so the same card has a button that runs the expiry now.
 *
 * As in AssetFormPage, each form is mounted only once the current value has loaded, so it can seed its
 * own state from a prop instead of filling itself in from an effect. Both settings are read in one
 * load, so the page has one loading state and one retry rather than two that can disagree.
 */
import { useCallback, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useApiResource } from '../hooks/useApiResource';
import { errorMessage } from '../services/api';
import * as organizationsApi from '../services/organizations.api';
import * as requestsApi from '../services/requests.api';
import { MAX_PICKUP_GRACE_HOURS, ORG_APPROVAL_OPTIONS } from '../utils/constants';
import { pluralize } from '../utils/format';

/**
 * The approval-default radio group and its save button.
 * @param {{ initialMode: string }} props
 * @returns {JSX.Element}
 */
function ApprovalSettingsForm({ initialMode }) {
  const [saved, setSaved] = useState(initialMode);
  const [mode, setMode] = useState(initialMode);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(null);

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await organizationsApi.updateApprovalSettings({ defaultMode: mode });
      setSaved(result.defaultMode);
      setMode(result.defaultMode);
      setNotice({
        tone: 'success',
        message:
          'Saved. The new rule applies to requests submitted from now on; requests already waiting stay in the queue.',
      });
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="approval-heading">
      <h2 id="approval-heading">Checkout approval</h2>
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert' : 'notice'}
        >
          {notice.message}
        </div>
      ) : null}
      <fieldset className="radio-group">
        <legend>By default, checkout requests should…</legend>
        {ORG_APPROVAL_OPTIONS.map((option) => (
          <div key={option.value} className="radio-option">
            <input
              type="radio"
              id={`approval-${option.value}`}
              name="defaultMode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              aria-describedby={`approval-${option.value}-hint`}
            />
            <label htmlFor={`approval-${option.value}`}>{option.label}</label>
            <p id={`approval-${option.value}-hint`} className="hint">
              {option.hint}
            </p>
          </div>
        ))}
      </fieldset>
      <p className="hint">
        Individual assets can override this from their edit form — for example, approve chargers
        automatically while cameras still need an approver.
      </p>
      <div className="actions">
        <button type="submit" disabled={pending || mode === saved}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/**
 * The pickup-window form and the "expire now" button (SCRUM-205).
 *
 * The number is kept as the text the admin typed, so clearing the field to retype it does not snap
 * back to 0. It is checked against the same bounds as the API (whole hours, 0 to 720) before saving.
 * @param {{ initialHours: number }} props
 * @returns {JSX.Element}
 */
function PickupSettingsForm({ initialHours }) {
  const [saved, setSaved] = useState(initialHours);
  const [hours, setHours] = useState(String(initialHours));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(null);

  const parsed = Number(hours);
  const valid =
    hours.trim() !== '' &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= MAX_PICKUP_GRACE_HOURS;

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await organizationsApi.updatePickupSettings({ graceHours: parsed });
      setSaved(result.graceHours);
      setHours(String(result.graceHours));
      setNotice({
        tone: 'success',
        message: 'Saved. The new window applies the next time approvals are expired.',
      });
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const onExpire = async () => {
    setPending(true);
    setNotice(null);
    try {
      const { expired } = await requestsApi.expireApprovals();
      setNotice({
        tone: 'success',
        message: `${pluralize(expired, 'approval')} expired and the units released.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="pickup-heading">
      <h2 id="pickup-heading">Pickup window</h2>
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'alert' : 'notice'}
        >
          {notice.message}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="pickup-grace-hours">Hours to collect an approved item</label>
        <input
          id="pickup-grace-hours"
          type="number"
          min={0}
          max={MAX_PICKUP_GRACE_HOURS}
          step={1}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          aria-describedby="pickup-grace-hours-hint"
          aria-invalid={!valid}
        />
        <p id="pickup-grace-hours-hint" className="hint">
          Counted from the start of the request. An approval nobody collects in time expires, and
          the unit becomes available again. Whole hours, up to {MAX_PICKUP_GRACE_HOURS}.
        </p>
      </div>
      <div className="actions">
        <button type="submit" disabled={pending || !valid || parsed === saved}>
          {pending ? 'Saving…' : 'Save pickup window'}
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={onExpire}>
          Expire uncollected approvals now
        </button>
      </div>
    </form>
  );
}

/**
 * Read both settings at once.
 * @param {AbortSignal} signal
 * @returns {Promise<{ approval: { defaultMode: string }, pickup: { graceHours: number } }>}
 */
async function loadSettings(signal) {
  const [approval, pickup] = await Promise.all([
    organizationsApi.getApprovalSettings(signal),
    organizationsApi.getPickupSettings(signal),
  ]);
  return { approval, pickup };
}

/**
 * Load the current settings and render the forms once they are known.
 * @returns {JSX.Element}
 */
export function OrgSettingsPage() {
  const fetcher = useCallback((signal) => loadSettings(signal), []);
  const { status, data, error, reload } = useApiResource(fetcher);

  return (
    <>
      <h1>Settings</h1>
      {status === 'loading' ? <LoadingState label="Loading settings…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the settings" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <>
          <ApprovalSettingsForm initialMode={data.approval.defaultMode} />
          <PickupSettingsForm initialHours={data.pickup.graceHours} />
        </>
      ) : null}
    </>
  );
}

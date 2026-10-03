// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-148 story)
// AI-Assisted Areas: organisation settings page with the approval default (REQUIRED / AUTO)
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
 * As in AssetFormPage, the form is mounted only once the current value has loaded, so it can seed its
 * own state from a prop instead of filling itself in from an effect.
 */
import { useCallback, useState } from 'react';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useApiResource } from '../hooks/useApiResource';
import { errorMessage } from '../services/api';
import * as organizationsApi from '../services/organizations.api';
import { ORG_APPROVAL_OPTIONS } from '../utils/constants';

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
 * Load the current settings and render the form once they are known.
 * @returns {JSX.Element}
 */
export function OrgSettingsPage() {
  const fetcher = useCallback((signal) => organizationsApi.getApprovalSettings(signal), []);
  const { status, data, error, reload } = useApiResource(fetcher);

  return (
    <>
      <h1>Settings</h1>
      {status === 'loading' ? <LoadingState label="Loading settings…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the settings" onRetry={reload} />
      ) : null}
      {status === 'success' && data ? (
        <ApprovalSettingsForm initialMode={data.defaultMode} />
      ) : null}
    </>
  );
}

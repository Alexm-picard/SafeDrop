// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-122 ticket)
// AI-Assisted Areas: one page serving both /admin/assets/new and /assets/:id/edit, with field-level API errors; approval mode select (SCRUM-148); group picker restricting who can request it (SCRUM-150, SCRUM-176)
// Human Contributions: pending team review
// Notes: Follows the form patterns in OrgSetupPage and MembersPage. Fields mirror the `assetBody`
// Zod schema in backend routes/assets.routes.js. Verified by
// tests/unit/components/AssetFormPage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * Create or edit an asset (ORG_ADMIN only).
 *
 * One component serves both routes because the two forms are the same four fields over the same
 * schema — the backend's `assetPatch` is literally `assetBody.partial()`. Splitting them would mean
 * two files that have to be changed together every time a field is added, which is exactly the drift
 * the shared schema was written to prevent. Edit mode is simply "we have an `:id`, so load the asset
 * first and PATCH instead of POST".
 *
 * Three details worth knowing:
 *
 * **The form is a separate component from the page.** `AssetFormPage` resolves the route and, in edit
 * mode, the asset; `AssetForm` is mounted only once there are values to put in it, so `useState` can
 * seed itself from a prop. The alternative — mounting an empty form and filling it in from an effect
 * — means inputs that visibly populate after paint, which reads as data loss, and it needs a
 * `setState` inside `useEffect` that React (and this repo's lint rules) rightly discourage.
 *
 * **An empty image URL is sent as `null`, not `""`.** `assetBody.imageUrl` is `z.url().nullable()`,
 * and the empty string is not a URL — sending it would fail validation on a field the admin
 * deliberately left blank. `null` is what "no image" means to that schema.
 *
 * **Validation is the server's answer, not the browser's.** The form is `noValidate` and sends what
 * was typed; the messages shown beside each field come from the API's own 400. That keeps client and
 * server from disagreeing about what is acceptable, and it is the only version that matters, since
 * the API validates regardless of what the UI allows (SR-6, G4).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingState } from '../components/LoadingState';
import { useAsset } from '../hooks/useAssets';
import { useGroups } from '../hooks/useGroups';
import { errorMessage, isApiError } from '../services/api';
import * as assetsApi from '../services/assets.api';
import { APPROVAL_MODE, ASSET_APPROVAL_OPTIONS, ROUTES } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';

/** A blank asset, matching `assetBody`'s own defaults for the optional fields. */
const EMPTY_FORM = Object.freeze({
  name: '',
  category: '',
  description: '',
  imageUrl: '',
  approvalMode: APPROVAL_MODE.INHERIT,
  allowedGroupIds: [],
});

/**
 * One page of groups is enough for the picker: the API's largest page is 100, far more groups than an
 * organisation restricting equipment by certification is likely to have.
 */
const GROUP_PICKER_PARAMS = Object.freeze({ page: 1, limit: 100 });

/**
 * Map an asset from the API onto the form's values.
 *
 * `null` becomes `''` because a controlled input cannot hold `null` without React warning that it
 * has switched from uncontrolled to controlled; `toPayload` reverses this on the way back out.
 * An asset from before SCRUM-148 has no `approvalMode`; it behaves as INHERIT, so the form shows that.
 * One from before SCRUM-150 has no `allowedGroupIds`; it is open to everyone, so nothing is ticked.
 * @param {object} asset
 * @returns {{ name: string, category: string, description: string, imageUrl: string, approvalMode: string, allowedGroupIds: string[] }}
 */
function toValues(asset) {
  return {
    name: asset.name ?? '',
    category: asset.category ?? '',
    description: asset.description ?? '',
    imageUrl: asset.imageUrl ?? '',
    approvalMode: asset.approvalMode ?? APPROVAL_MODE.INHERIT,
    allowedGroupIds: asset.allowedGroupIds ?? [],
  };
}

/**
 * Map the form's values onto the request body the API expects.
 *
 * Trimming here rather than on each keystroke lets an admin type a space mid-value; the schema trims
 * too, so this only keeps the request honest about what will be stored.
 * @param {{ name: string, category: string, description: string, imageUrl: string, approvalMode: string, allowedGroupIds: string[] }} values
 * @returns {{ name: string, category: string, description: string, imageUrl: string|null, approvalMode: string, allowedGroupIds: string[] }}
 */
function toPayload(values) {
  const imageUrl = values.imageUrl.trim();
  return {
    name: values.name.trim(),
    category: values.category.trim(),
    description: values.description.trim(),
    imageUrl: imageUrl === '' ? null : imageUrl,
    approvalMode: values.approvalMode,
    allowedGroupIds: values.allowedGroupIds,
  };
}

/**
 * The asset fields, their submit handling and their errors.
 *
 * Seeded from `initialValues`, which is why the page mounts it only once those exist. `save` is
 * injected rather than chosen here so this component does not need to know whether it is creating or
 * updating — the difference is one API call, and it belongs with the routing that decided it.
 * @param {{ initialValues: object, isEdit: boolean, save: (payload: object) => Promise<object>, onSaved: (saved: object, payload: object) => void, onCancel: () => void }} props
 * @returns {JSX.Element}
 */
function AssetForm({ initialValues, isEdit, save, onSaved, onCancel }) {
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));
  const toggleGroup = (groupId) => (event) =>
    setValues((prev) => ({
      ...prev,
      allowedGroupIds: event.target.checked
        ? [...prev.allowedGroupIds, groupId]
        : prev.allowedGroupIds.filter((id) => id !== groupId),
    }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    const payload = toPayload(values);
    try {
      onSaved(await save(payload), payload);
    } catch (err) {
      if (isApiError(err)) {
        const perField = fieldErrorsOf(err);
        setFieldErrors(perField);
        if (Object.keys(perField).length === 0) {
          setFormError(errorMessage(err));
        }
      } else {
        setFormError(errorMessage(err));
      }
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate aria-labelledby="asset-form-title">
      <h2 id="asset-form-title" className="visually-hidden">
        {isEdit ? 'Edit asset' : 'New asset'}
      </h2>
      {formError ? (
        <div role="alert" className="alert">
          {formError}
        </div>
      ) : null}
      <FormField id="asset-name" label="Name" error={fieldErrors.name}>
        {(props) => (
          <input
            {...props}
            name="name"
            type="text"
            autoComplete="off"
            required
            value={values.name}
            onChange={set('name')}
          />
        )}
      </FormField>
      <FormField
        id="asset-category"
        label="Category"
        error={fieldErrors.category}
        hint="For example: laptop, camera, projector."
      >
        {(props) => (
          <input
            {...props}
            name="category"
            type="text"
            autoComplete="off"
            required
            value={values.category}
            onChange={set('category')}
          />
        )}
      </FormField>
      <FormField id="asset-description" label="Description" error={fieldErrors.description}>
        {(props) => (
          <textarea
            {...props}
            name="description"
            rows={3}
            value={values.description}
            onChange={set('description')}
          />
        )}
      </FormField>
      <FormField
        id="asset-imageUrl"
        label="Image URL"
        error={fieldErrors.imageUrl}
        hint="Optional. Leave blank if there is no picture."
      >
        {(props) => (
          <input
            {...props}
            name="imageUrl"
            type="url"
            autoComplete="off"
            value={values.imageUrl}
            onChange={set('imageUrl')}
          />
        )}
      </FormField>
      <FormField
        id="asset-approvalMode"
        label="Checkout approval"
        error={fieldErrors.approvalMode}
        hint="Whether a request for this asset waits for an approver. Approved items are still handed over in person."
      >
        {(props) => (
          <select
            {...props}
            name="approvalMode"
            value={values.approvalMode}
            onChange={set('approvalMode')}
          >
            {ASSET_APPROVAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <GroupPicker
        selected={values.allowedGroupIds}
        onToggle={toggleGroup}
        error={fieldErrors.allowedGroupIds}
      />
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create asset'}
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Who may request this asset (SCRUM-150, SCRUM-176): a checkbox per group in the organisation.
 *
 * Nothing ticked means everyone may; ticking several means membership of any one is enough, so an
 * asset can accept both a narrow certification and a broad one that covers it.
 *
 * If the groups cannot be loaded the picker says so and shows no boxes, and the form still sends the
 * asset's current `allowedGroupIds` unchanged — an admin editing a description must not silently lift
 * a restriction because the group list failed to load.
 * @param {{ selected: string[], onToggle: (groupId: string) => (event: object) => void, error?: string }} props
 * @returns {JSX.Element}
 */
function GroupPicker({ selected, onToggle, error }) {
  const { status, data } = useGroups(GROUP_PICKER_PARAMS);
  const groups = data?.items ?? [];

  let body;
  if (status === 'error') {
    body = (
      <p className="hint">
        Could not load the groups, so this cannot be changed right now. Saving keeps the current
        setting.
      </p>
    );
  } else if (!data) {
    body = <p className="hint">Loading groups…</p>;
  } else if (groups.length === 0) {
    body = <p className="hint">No groups yet, so everyone in the organization can request this.</p>;
  } else {
    body = groups.map((group) => (
      <div key={group.id} className="radio-option">
        <input
          type="checkbox"
          id={`asset-group-${group.id}`}
          checked={selected.includes(group.id)}
          onChange={onToggle(group.id)}
        />
        <label htmlFor={`asset-group-${group.id}`}>{group.name}</label>
      </div>
    ));
  }

  return (
    <fieldset
      className="radio-group"
      aria-describedby={['asset-groups-hint', error ? 'asset-groups-error' : null]
        .filter(Boolean)
        .join(' ')}
      aria-invalid={error ? true : undefined}
    >
      <legend>Who can request this</legend>
      <p id="asset-groups-hint" className="hint">
        Leave every group unticked to let anyone in the organization request it. Tick groups to
        restrict it: a member of any one of them can request it.
      </p>
      {body}
      {error ? (
        <span id="asset-groups-error" className="field-error">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/**
 * Render the create or edit form, deciding which from the presence of an `:id` route parameter.
 *
 * In edit mode the asset's three load states are handled here, and the form is mounted only on
 * success. On save the admin is sent to the asset's page with a notice carried in the router's
 * location state, because the confirmation belongs where the result is visible — and `replace` keeps
 * the form out of the back history, so Back returns to wherever they came from rather than
 * re-opening a form they have already submitted.
 * @returns {JSX.Element}
 */
export function AssetFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { status, data, error, reload } = useAsset(isEdit ? id : '');

  const title = isEdit ? 'Edit asset' : 'New asset';

  const onSaved = (saved, payload) =>
    navigate(ROUTES.asset(saved?.id ?? id), {
      replace: true,
      state: { notice: isEdit ? 'Asset updated.' : `Created ${payload.name}.` },
    });
  const onCancel = () => navigate(isEdit ? ROUTES.asset(id) : ROUTES.catalog);

  if (isEdit && status === 'loading') {
    return (
      <>
        <h1>{title}</h1>
        <LoadingState label="Loading asset…" />
      </>
    );
  }
  if (isEdit && (status === 'error' || !data)) {
    return (
      <>
        <h1>{title}</h1>
        <ErrorState error={error} title="Could not load this asset" onRetry={reload} />
      </>
    );
  }

  return (
    <>
      <h1>{title}</h1>
      <p className="hint">
        {isEdit
          ? 'Changes are recorded in the audit log.'
          : 'Add a catalogue entry. You can add its physical units from the asset’s page afterwards.'}
      </p>
      <AssetForm
        initialValues={isEdit ? toValues(data) : EMPTY_FORM}
        isEdit={isEdit}
        save={(payload) => (isEdit ? assetsApi.update(id, payload) : assetsApi.create(payload))}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </>
  );
}

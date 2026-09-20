// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-122 ticket)
// AI-Assisted Areas: add-unit form with a duplicate-tag 409 rendered under the tag input
// Human Contributions: pending team review
// Notes: Fields mirror the `unitBody` Zod schema in backend routes/assets.routes.js. Verified by
// tests/unit/components/AssetDetailPage.test.jsx. Must be reviewed by the owning team member before merge.

import { useState } from 'react';
import { errorMessage, isApiError } from '../services/api';
import * as assetsApi from '../services/assets.api';
import { ASSET_CONDITIONS, DEFAULT_ASSET_CONDITION } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';
import { humanize } from '../utils/format';
import { FormField } from './FormField';

/** A blank unit, matching `unitBody`'s own defaults. */
const EMPTY_FORM = Object.freeze({
  tag: '',
  serial: '',
  condition: DEFAULT_ASSET_CONDITION,
});

/**
 * Add one physical unit to an asset.
 *
 * The tag is the identifier on the item's sticker and is unique per organisation, so the interesting
 * case is the second time someone types `a-001`: the API answers 409 with `details.field = 'tag'`,
 * and `fieldErrorsOf` turns that into a message under the tag input. A duplicate tag is a typo, and
 * a typo should be shown at the box that has the typo in it — not as a banner the admin has to map
 * back to a field themselves.
 *
 * There is no status field. A new unit's lifecycle always begins at AVAILABLE, which the server
 * assigns; accepting it from the client would let an admin create a unit that is already checked out
 * to nobody.
 */

/**
 * Render the add-unit form.
 *
 * Reports success upward through `onAdded` rather than rendering its own confirmation, because the
 * new unit belongs in the page's units table and the page owns the single notice area. The form
 * resets on success so the next unit — usually one of a batch — can be typed straight away.
 * @param {{ assetId: string, onAdded: (unit: object) => void }} props
 * @returns {JSX.Element}
 */
export function AddUnitForm({ assetId, onAdded }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const serial = values.serial.trim();
      const unit = await assetsApi.addUnit(assetId, {
        tag: values.tag.trim(),
        serial: serial === '' ? null : serial,
        condition: values.condition,
      });
      setValues(EMPTY_FORM);
      onAdded(unit);
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
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate aria-labelledby="add-unit-title">
      <h2 id="add-unit-title">Add a unit</h2>
      {formError ? (
        <div role="alert" className="alert">
          {formError}
        </div>
      ) : null}
      <FormField
        id="unit-tag"
        label="Tag"
        error={fieldErrors.tag}
        hint="The identifier on the item itself. Must be unique in your organization."
      >
        {(props) => (
          <input
            {...props}
            name="tag"
            type="text"
            autoComplete="off"
            required
            value={values.tag}
            onChange={set('tag')}
          />
        )}
      </FormField>
      <FormField id="unit-serial" label="Serial number" error={fieldErrors.serial} hint="Optional.">
        {(props) => (
          <input
            {...props}
            name="serial"
            type="text"
            autoComplete="off"
            value={values.serial}
            onChange={set('serial')}
          />
        )}
      </FormField>
      <FormField id="unit-condition" label="Condition" error={fieldErrors.condition}>
        {(props) => (
          <select {...props} name="condition" value={values.condition} onChange={set('condition')}>
            {ASSET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {humanize(condition)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add unit'}
      </button>
    </form>
  );
}

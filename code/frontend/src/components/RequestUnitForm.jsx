// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the SCRUM-124 ticket)
// AI-Assisted Areas: checkout request form — date window mirroring createRequestBody, with field-level API errors
// Human Contributions: pending team review
// Notes: Fields mirror the `createRequestBody` Zod schema in backend routes/requests.routes.js; the
// window rule itself lives in utils/requestWindow.js — change it and the schema together. Verified by
// tests/unit/components/RequestCreation.test.jsx. Must be reviewed by the owning team member before merge.

import { useState } from 'react';
import { errorMessage, isApiError } from '../services/api';
import * as requestsApi from '../services/requests.api';
import { fieldErrorsOf } from '../utils/formErrors';
import { validateWindow } from '../utils/requestWindow';
import { FormField } from './FormField';

/** A blank request window, matching `createRequestBody`'s own default for `note`. */
const EMPTY_FORM = Object.freeze({
  neededFrom: '',
  neededTo: '',
  note: '',
});

/**
 * Request one unit for a date window.
 *
 * Rendered on the asset detail page beneath the units table, bound to the unit whose "Request this"
 * button was pressed. It is a form on the page rather than its own route because the decision it
 * supports — which of these units, for when — is made while looking at the table of units, and
 * sending the member to a separate screen would take that away.
 *
 * The interesting failure is the race the acceptance criteria name: the units table was rendered
 * from a response that is already a few seconds old, so between loading the page and pressing
 * Submit someone else may have taken the unit. The server refuses, and `onFailed` tells the page to
 * refetch so the table stops claiming the unit is available. The message is rendered here, next to
 * the button that failed, rather than in the page's notice area, so it sits where the member is
 * looking.
 *
 * `requesterId` is not a field: who is asking comes from the session server-side, so one member
 * cannot file a request in another's name.
 * @param {{ unit: object, onCreated: (request: object) => void, onFailed: () => void, onCancel: () => void }} props
 * @returns {JSX.Element}
 */
export function RequestUnitForm({ unit, onCreated, onFailed, onCancel }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);

    const clientErrors = validateWindow(values);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setPending(true);
    setFieldErrors({});
    try {
      const created = await requestsApi.create({
        unitId: unit.id,
        neededFrom: values.neededFrom,
        neededTo: values.neededTo,
        note: values.note.trim(),
      });
      onCreated(created);
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
      // Whatever went wrong, what this page is showing about the unit may now be stale — most
      // obviously when the refusal is "somebody else has it". Ask the page to refetch.
      onFailed();
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate aria-labelledby="request-unit-title">
      <h2 id="request-unit-title">Request unit {unit.tag}</h2>
      {formError ? (
        <div role="alert" className="alert">
          {formError}
        </div>
      ) : null}
      <FormField id="needed-from" label="Needed from" error={fieldErrors.neededFrom}>
        {(props) => (
          <input
            {...props}
            name="neededFrom"
            type="date"
            required
            value={values.neededFrom}
            onChange={set('neededFrom')}
          />
        )}
      </FormField>
      <FormField id="needed-to" label="Needed until" error={fieldErrors.neededTo}>
        {(props) => (
          <input
            {...props}
            name="neededTo"
            type="date"
            required
            value={values.neededTo}
            onChange={set('neededTo')}
          />
        )}
      </FormField>
      <FormField
        id="request-note"
        label="Note"
        error={fieldErrors.note}
        hint="Optional. Anything the approver should know."
      >
        {(props) => (
          <textarea {...props} name="note" rows={2} value={values.note} onChange={set('note')} />
        )}
      </FormField>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit request'}
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-167)
// AI-Assisted Areas: Groups screen: the organisation's groups with member counts, and the create form with a field-level duplicate-name error
// Human Contributions: pending team review
// Notes: Follows the patterns in MembersPage (list, single notice area) and AssetFormPage (FormField, field errors). Verified by tests/unit/components/GroupsPage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * The Groups screen (ORG_ADMIN only, SCRUM-167): the organisation's user groups and a form to create
 * one.
 *
 * A group is a named set of members — "Certified Drone Pilots", "Film Dept Staff" — and restricted
 * equipment points at groups (SCRUM-150) to say who may borrow it. Groups are not roles: a role says
 * what someone can *do* in the app, a group says which equipment they may *borrow* (SCRUM-149).
 *
 * **Creating a group opens it.** A new group is always empty — members are added one at a time, each
 * its own audit event — so the next thing an admin does is add people, and that happens on the
 * group's own page.
 *
 * **One page of up to 100 groups, no pagination.** The API's largest page is 100, well beyond what an
 * organisation grouping people by training or department needs; the count says so if that ever
 * stops being true.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingState } from '../components/LoadingState';
import { useGroups } from '../hooks/useGroups';
import { errorMessage, isApiError } from '../services/api';
import * as groupsApi from '../services/groups.api';
import { ROUTES } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';
import { pluralize } from '../utils/format';

/** The whole list in one request: the API's largest page. */
const GROUPS_PARAMS = Object.freeze({ page: 1, limit: 100 });

const EMPTY_FORM = Object.freeze({ name: '', description: '' });

/**
 * The create form.
 *
 * Validation is the server's answer: the form is `noValidate` and a duplicate name (409, `details.field
 * = 'name'`, in any letter case) lands under the name input through `fieldErrorsOf`.
 * @param {{ onCreated: (group: object) => void }} props
 * @returns {JSX.Element}
 */
function CreateGroupForm({ onCreated }) {
  const [values, setValues] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const { group } = await groupsApi.create({
        name: values.name.trim(),
        description: values.description.trim(),
      });
      onCreated(group);
    } catch (err) {
      const perField = isApiError(err) ? fieldErrorsOf(err) : {};
      setFieldErrors(perField);
      if (Object.keys(perField).length === 0) {
        setError(errorMessage(err));
      }
      setPending(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate aria-labelledby="create-group-title">
      <h2 id="create-group-title">Create a group</h2>
      {error ? (
        <div role="alert" className="alert">
          {error}
        </div>
      ) : null}
      <FormField
        id="group-name"
        label="Name"
        error={fieldErrors.name}
        hint="For example: Certified Drone Pilots, Film Dept Staff."
      >
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
        id="group-description"
        label="Description"
        error={fieldErrors.description}
        hint="Optional. What being in this group means, such as a course they passed."
      >
        {(props) => (
          <textarea
            {...props}
            name="description"
            rows={2}
            value={values.description}
            onChange={set('description')}
          />
        )}
      </FormField>
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

/**
 * Render the Groups screen.
 *
 * `notice` carries what the group page did before sending the admin back here (a deletion), via the
 * router's location state.
 * @returns {JSX.Element}
 */
export function GroupsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, data, error, reload } = useGroups(GROUPS_PARAMS);
  const [notice, setNotice] = useState(location.state?.notice ?? null);

  const onCreated = (group) =>
    navigate(ROUTES.group(group.id), {
      state: { notice: `Created ${group.name}. Add its members below.` },
    });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <h1>Groups</h1>
      <p className="hint">
        Groups decide who may borrow restricted equipment: an asset restricted to a group can only
        be requested by its members. Every change is recorded in the audit log.
      </p>

      {notice ? (
        <div role="status" className="notice">
          <p>{notice}</p>
          <button type="button" className="secondary" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <CreateGroupForm onCreated={onCreated} />

      {status === 'loading' && !data ? <LoadingState label="Loading groups…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the groups" onRetry={reload} />
      ) : null}
      {status !== 'error' && data ? (
        <>
          <p className="hint">
            {pluralize(total, 'group')}
            {total > items.length ? ` (showing the first ${items.length})` : ''}
          </p>
          <DataTable
            caption="Groups in your organization"
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (g) => <Link to={ROUTES.group(g.id)}>{g.name}</Link>,
              },
              { key: 'description', header: 'Description', render: (g) => g.description },
              { key: 'members', header: 'Members', render: (g) => String(g.memberCount) },
            ]}
            rows={items}
            getRowId={(g) => g.id}
            emptyMessage="No groups yet. Create one above, then add its members."
          />
        </>
      ) : null}
    </>
  );
}

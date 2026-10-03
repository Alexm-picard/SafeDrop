// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-167)
// AI-Assisted Areas: one group's page: rename and redescribe, its members with remove, add a member from the organisation, delete with confirmation; the equipment it restricts, named in the delete confirmation (SCRUM-204); UI rework: header with Edit details and Delete, members (with an add bar) and equipment as equal fixed-height panels
// Human Contributions: pending team review
// Notes: Follows the patterns in AssetDetailPage (single notice area, content kept on screen while it reloads, ConfirmAction) and MembersPage. Verified by tests/unit/components/GroupDetailPage.test.jsx. Must be reviewed by the owning team member before merge.

/**
 * One user group (ORG_ADMIN only, SCRUM-167): who is in it, and the controls to change that.
 *
 * Membership changes one person at a time, matching the API (each add and remove is its own audit
 * event). The add and remove routes answer with the group's member *ids* only, so after each change
 * the page re-reads the group to show names — and, as on AssetDetailPage, keeps the current content
 * on screen while it does, so the control the admin just used does not vanish from under them.
 *
 * **A deactivated member stays listed, marked Deactivated.** SCRUM-149 decided deactivation does not
 * remove anyone from a group (the history stays meaningful); it makes them fail every eligibility
 * check instead. The page shows that rather than hiding them, and does not offer deactivated people
 * in the add list, since adding them would grant nothing.
 *
 * **The page lists the equipment the group restricts (SCRUM-204)**, and the delete confirmation names
 * the assets for which this is the only listed group: deleting it leaves those requestable by nobody
 * until an admin changes them (SCRUM-150 fails closed rather than opening them up).
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ConfirmAction } from '../components/ConfirmAction';
import { DataTable } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingState } from '../components/LoadingState';
import { Pagination } from '../components/Pagination';
import { useGroup } from '../hooks/useGroups';
import { useMembers } from '../hooks/useMembers';
import { usePagination } from '../hooks/usePagination';
import { errorMessage, isApiError } from '../services/api';
import * as groupsApi from '../services/groups.api';
import { ROUTES } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';
import { pluralize } from '../utils/format';

/**
 * Rows per page in the members and restricted-equipment panels. The two panels share one fixed
 * height (`.panel--group` in index.css), sized for this many two-line member rows under the add bar,
 * or this many one-line equipment rows — so the page keeps its shape whether a group has one member
 * or fifty. Change these and that height together.
 */
const MEMBER_PAGE_SIZE = 5;
const EQUIPMENT_PAGE_SIZE = 10;

/** Candidates for the add list: one page of the organisation's members, the API's largest. */
const MEMBERS_PARAMS = Object.freeze({ page: 1, limit: 100 });

/**
 * Rename the group or change its description.
 *
 * Opened from the header's Edit details button and closed by saving or cancelling, so it takes no
 * room on the page the rest of the time. Seeded from the group each time it opens. A duplicate name
 * (409, any letter case) lands under the name input.
 * @param {{ group: object, onSaved: () => void, onCancel: () => void }} props
 * @returns {JSX.Element}
 */
function EditGroupForm({ group, onSaved, onCancel }) {
  const [values, setValues] = useState({ name: group.name, description: group.description ?? '' });
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
      await groupsApi.update(group.id, {
        name: values.name.trim(),
        description: values.description.trim(),
      });
      onSaved();
    } catch (err) {
      const perField = isApiError(err) ? fieldErrorsOf(err) : {};
      setFieldErrors(perField);
      if (Object.keys(perField).length === 0) {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="card edit-details"
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="edit-group-title"
    >
      <h2 id="edit-group-title">Edit details</h2>
      {error ? (
        <div role="alert" className="alert">
          {error}
        </div>
      ) : null}
      <div className="form-row">
        <FormField id="group-name" label="Name" error={fieldErrors.name}>
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
        <FormField id="group-description" label="Description" error={fieldErrors.description}>
          {(props) => (
            <textarea
              {...props}
              name="description"
              rows={1}
              value={values.description}
              onChange={set('description')}
            />
          )}
        </FormField>
      </div>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Pick someone from the organisation and add them.
 *
 * Offers only active members not already in the group. If the member list cannot be loaded the form
 * says so instead of offering an empty choice.
 * @param {{ memberIds: string[], pending: boolean, onAdd: (user: object) => void }} props
 * @returns {JSX.Element}
 */
function AddMemberForm({ memberIds, pending, onAdd }) {
  const { status, data } = useMembers(MEMBERS_PARAMS);
  const [userId, setUserId] = useState('');

  const candidates = useMemo(
    () => (data?.items ?? []).filter((u) => !u.deactivatedAt && !memberIds.includes(u.id)),
    [data, memberIds],
  );

  const onSubmit = (event) => {
    event.preventDefault();
    const user = candidates.find((u) => u.id === userId);
    if (user) {
      setUserId('');
      onAdd(user);
    }
  };

  let body;
  if (status === 'error') {
    body = <p className="hint">Could not load the organization’s members. Try again later.</p>;
  } else if (!data) {
    body = <p className="hint">Loading members…</p>;
  } else if (candidates.length === 0) {
    body = <p className="hint">Everyone active in the organization is already in this group.</p>;
  } else {
    body = (
      <>
        <label htmlFor="add-member" className="visually-hidden">
          Member to add
        </label>
        <select
          id="add-member"
          name="userId"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Choose a member…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <button type="submit" className="small" disabled={pending || !userId}>
          {pending ? 'Adding…' : 'Add to group'}
        </button>
      </>
    );
  }

  return (
    <form className="panel-toolbar" onSubmit={onSubmit} noValidate aria-label="Add a member">
      {body}
    </form>
  );
}

/**
 * Join names the way a person would list them: "A", "A and B", "A, B and C".
 * @param {string[]} names
 * @returns {string}
 */
function listOf(names) {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0];
}

/**
 * The delete confirmation, saying exactly what happens to the equipment restricted to this group
 * (SCRUM-204).
 * @param {{ name: string, restrictedAssets?: { name: string, onlyGroup: boolean }[] }} group
 * @returns {string}
 */
function deletePrompt(group) {
  const assets = group.restrictedAssets ?? [];
  const stranded = assets.filter((a) => a.onlyGroup).map((a) => a.name);
  const start = `Delete ${group.name}? Its members are not affected`;
  if (assets.length === 0) {
    return `${start}, and no equipment is restricted to it.`;
  }
  if (stranded.length > 0) {
    return `${start}, but nobody will be able to request ${listOf(stranded)} until you change its restriction.`;
  }
  return `${start}. The equipment restricted to it stays available to the members of its other groups.`;
}

/**
 * The equipment restricted to this group, each linking to the asset, marking where this is the only
 * group that can borrow it (SCRUM-204).
 * @param {{ assets: { id: string, name: string, onlyGroup: boolean }[] }} props
 * @returns {JSX.Element}
 */
function RestrictedEquipment({ assets }) {
  const { pageItems, page, pageCount, setPage } = usePagination(assets, EQUIPMENT_PAGE_SIZE);
  return (
    <section
      className="panel panel--fixed panel--group"
      aria-labelledby="restricted-equipment-title"
    >
      <div className="panel-header">
        <h2 id="restricted-equipment-title">Restricted equipment</h2>
        <span className="hint">{pluralize(assets.length, 'asset')}</span>
      </div>
      {assets.length === 0 ? (
        <p className="hint">No equipment is restricted to this group.</p>
      ) : (
        <ul className="item-list" aria-label="Equipment restricted to this group">
          {pageItems.map((asset) => (
            <li key={asset.id}>
              <Link to={ROUTES.asset(asset.id)}>{asset.name}</Link>
              {asset.onlyGroup ? (
                <span className="hint"> — only this group can borrow it</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        pageCount={pageCount}
        onChange={setPage}
        label="Restricted equipment pages"
      />
    </section>
  );
}

/**
 * Render one group, keyed by the `:id` route parameter.
 * @returns {JSX.Element}
 */
export function GroupDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { status, data, error, reload } = useGroup(id);
  const [notice, setNotice] = useState(
    location.state?.notice ? { tone: 'success', message: location.state.notice } : null,
  );
  // Which membership change is in flight: a user id while removing that row, 'add' while adding.
  const [changing, setChanging] = useState(null);
  const [editing, setEditing] = useState(false);

  const group = data?.group ?? null;

  const onSaved = useCallback(() => {
    setEditing(false);
    setNotice({ tone: 'success', message: 'Group updated.' });
    reload();
  }, [reload]);

  const onAdd = useCallback(
    async (user) => {
      setNotice(null);
      setChanging('add');
      try {
        await groupsApi.addMember(id, user.id);
        setNotice({ tone: 'success', message: `Added ${user.name} to the group.` });
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setChanging(null);
      }
    },
    [id, reload],
  );

  const onRemove = useCallback(
    async (user) => {
      setNotice(null);
      setChanging(user.id);
      try {
        await groupsApi.removeMember(id, user.id);
        setNotice({ tone: 'success', message: `Removed ${user.name} from the group.` });
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setChanging(null);
      }
    },
    [id, reload],
  );

  const onDelete = useCallback(async () => {
    setNotice(null);
    try {
      await groupsApi.remove(id);
      navigate(ROUTES.groups, { replace: true, state: { notice: `Deleted ${group?.name}.` } });
    } catch (err) {
      setNotice({ tone: 'error', message: errorMessage(err) });
    }
  }, [id, group, navigate]);

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">
            <Link to={ROUTES.groups}>← All groups</Link>
          </span>
          <h1>{group ? group.name : 'Group'}</h1>
          {group?.description ? <p className="subtitle">{group.description}</p> : null}
        </div>
        {status !== 'error' && group ? (
          <div className="actions">
            <button
              type="button"
              className="secondary"
              aria-expanded={editing}
              aria-controls="edit-group"
              onClick={() => setEditing((open) => !open)}
            >
              Edit details
            </button>
            <ConfirmAction
              label="Delete group"
              prompt={deletePrompt(group)}
              confirmLabel="Yes, delete it"
              pendingLabel="Deleting…"
              onConfirm={onDelete}
            />
          </div>
        ) : null}
      </header>
      {status === 'loading' && !data ? <LoadingState label="Loading group…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load this group" onRetry={reload} />
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
      {status !== 'error' && group ? (
        <>
          {editing ? (
            <div id="edit-group">
              <EditGroupForm
                key={group.id}
                group={group}
                onSaved={onSaved}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : null}
          <div className="split split--lists">
            <section
              className="panel panel--fixed panel--group"
              aria-labelledby="group-members-title"
            >
              <div className="panel-header">
                <h2 id="group-members-title">Members</h2>
                <span className="hint">{pluralize((group.members ?? []).length, 'member')}</span>
              </div>
              <AddMemberForm
                memberIds={group.memberIds ?? []}
                pending={changing === 'add'}
                onAdd={onAdd}
              />
              <DataTable
                caption="Members of this group"
                hideCaption
                pageSize={MEMBER_PAGE_SIZE}
                columns={[
                  {
                    key: 'name',
                    header: 'Name',
                    render: (u) => (
                      <>
                        <span className="cell-primary">{u.name}</span>
                        <span className="cell-secondary">{u.email}</span>
                      </>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    // Still listed, but fails every eligibility check (SCRUM-149's answer).
                    render: (u) =>
                      u.deactivatedAt ? (
                        <span className="badge" data-tone="neutral">
                          Deactivated
                        </span>
                      ) : (
                        <span className="badge" data-tone="ok">
                          Active
                        </span>
                      ),
                  },
                  {
                    key: 'remove',
                    header: 'Remove',
                    className: 'numeric',
                    render: (u) => (
                      <button
                        type="button"
                        className="secondary small"
                        aria-label={`Remove ${u.name} from the group`}
                        disabled={changing === u.id}
                        onClick={() => onRemove(u)}
                      >
                        {changing === u.id ? 'Removing…' : 'Remove'}
                      </button>
                    ),
                  },
                ]}
                rows={group.members ?? []}
                getRowId={(u) => u.id}
                emptyMessage="Nobody is in this group yet."
              />
            </section>
            <RestrictedEquipment assets={group.restrictedAssets ?? []} />
          </div>
        </>
      ) : null}
    </>
  );
}

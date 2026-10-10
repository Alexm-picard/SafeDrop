// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from SCRUM-167)
// AI-Assisted Areas: Groups screen: the organisation's groups with member counts, and the create form with a field-level duplicate-name error; UI rework: list panel beside the create form; SCRUM-241 redesign: a membership grid (people by groups, a peg per membership to toggle), each group's restricted equipment in its column, "who can borrow what", create in a side panel
// Human Contributions: reviewed and approved by Mateus Silva (PR #60, 2026-10-03); latest changes reviewed and merged by Orelmis Toribio (PR #70, 2026-10-10); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Follows the patterns in MembersPage (list, single notice area) and AssetFormPage (FormField, field errors). Verified by tests/unit/components/GroupsPage.test.jsx. Reviewed before merge; see Human Contributions.

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
 * **SCRUM-241: a membership grid.** People down the side, groups across the top, a peg where someone
 * is in a group: pressing a peg adds or removes that person, one audit event each, exactly as the
 * group's own page does. Each column names the equipment restricted to that group, and a summary
 * under the grid says who can borrow what. Renaming, describing and deleting a group stay on its own
 * page, which its column heading links to. People come from one page of up to 100 members.
 *
 * **One page of up to 100 groups, no pagination.** The API's largest page is 100, well beyond what an
 * organisation grouping people by training or department needs; the count says so if that ever
 * stops being true.
 */
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Drawer } from '../components/Drawer';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingState } from '../components/LoadingState';
import { useAssets } from '../hooks/useAssets';
import { useGroups } from '../hooks/useGroups';
import { useMembers } from '../hooks/useMembers';
import { errorMessage, isApiError } from '../services/api';
import * as groupsApi from '../services/groups.api';
import { ROLE_LABELS, ROUTES } from '../utils/constants';
import { fieldErrorsOf } from '../utils/formErrors';
import { pluralize } from '../utils/format';

/** The whole list in one request: the API's largest page. */
const GROUPS_PARAMS = Object.freeze({ page: 1, limit: 100 });

const EMPTY_FORM = Object.freeze({ name: '', description: '' });

/** The people down the side of the grid: one page of the organisation, the API's largest. */
const PEOPLE_PARAMS = Object.freeze({ page: 1, limit: 100 });
/** The catalogue, to name the equipment each group restricts. */
const ASSET_PARAMS = Object.freeze({ limit: 100 });

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
    <form onSubmit={onSubmit} noValidate aria-label="Create a group">
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
 * router's location state, and what the grid just did (a membership added or removed).
 * @returns {JSX.Element}
 */
export function GroupsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, data, error, reload } = useGroups(GROUPS_PARAMS);
  const people = useMembers(PEOPLE_PARAMS);
  const catalogue = useAssets(ASSET_PARAMS);
  const [notice, setNotice] = useState(
    location.state?.notice ? { tone: 'success', message: location.state.notice } : null,
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);

  const onCreated = (group) =>
    navigate(ROUTES.group(group.id), {
      state: { notice: `Created ${group.name}. Add its members below.` },
    });

  const toggle = useCallback(
    async (group, person, isIn) => {
      setBusy(`${group.id}:${person.id}`);
      setNotice(null);
      try {
        if (isIn) {
          await groupsApi.removeMember(group.id, person.id);
        } else {
          await groupsApi.addMember(group.id, person.id);
        }
        setNotice({
          tone: 'success',
          message: isIn
            ? `Removed ${person.name} from ${group.name}.`
            : `Added ${person.name} to ${group.name}.`,
        });
        reload();
      } catch (err) {
        setNotice({ tone: 'error', message: errorMessage(err) });
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const members = people.data?.items ?? [];
  const assets = catalogue.data?.items ?? [];
  const restricted = assets.filter((a) => (a.allowedGroups ?? []).length > 0 || a.restricted);
  const gearOf = (group) =>
    assets.filter((a) => (a.allowedGroups ?? []).some((g) => g.id === group.id));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Groups</h1>
          <p className="subtitle">
            Groups decide who may borrow restricted equipment: an asset restricted to a group can
            only be requested by its members. Press a peg to put someone in a group or take them
            out. Every change is recorded in the audit log.
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setCreating(true)}>
            New group
          </button>
        </div>
      </header>

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

      {status === 'loading' && !data ? <LoadingState label="Loading groups…" /> : null}
      {status === 'error' ? (
        <ErrorState error={error} title="Could not load the groups" onRetry={reload} />
      ) : null}
      {status !== 'error' && data ? (
        items.length === 0 ? (
          <div className="empty-state">
            <p>No groups yet. Create one, then add its members.</p>
            <button type="button" onClick={() => setCreating(true)}>
              New group
            </button>
          </div>
        ) : (
          <>
            <p className="hint">
              {pluralize(total, 'group')}
              {total > items.length ? ` (showing the first ${items.length})` : ''}
            </p>
            <div className="matrix-wrap">
              <table className="matrix">
                <caption className="visually-hidden">Groups in your organization</caption>
                <thead>
                  <tr>
                    <th scope="col" className="matrix-corner">
                      {people.status === 'error'
                        ? 'Could not load the members'
                        : pluralize(members.length, 'person', 'people')}
                    </th>
                    {items.map((g) => {
                      const gear = gearOf(g);
                      return (
                        <th key={g.id} scope="col">
                          <Link className="matrix-group" to={ROUTES.group(g.id)}>
                            <strong>{g.name}</strong>
                            <span>{pluralize(g.memberCount, 'member')}</span>
                          </Link>
                          {g.description ? (
                            <p className="matrix-description">{g.description}</p>
                          ) : null}
                          <p className="matrix-gear">
                            {gear.length
                              ? gear.map((a) => (
                                  <Link key={a.id} className="gear-chip" to={ROUTES.asset(a.id)}>
                                    {a.name}
                                  </Link>
                                ))
                              : 'No equipment restricted to it'}
                          </p>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {members.map((person) => {
                    const inactive = Boolean(person.deactivatedAt);
                    return (
                      <tr key={person.id}>
                        <th scope="row">
                          <span className="matrix-person">
                            <Avatar name={person.name} role={person.role} size="sm" />
                            <span>
                              <strong>{person.name}</strong>
                              <span>{inactive ? 'Deactivated' : ROLE_LABELS[person.role]}</span>
                            </span>
                          </span>
                        </th>
                        {items.map((g) => {
                          const isIn = (g.memberIds ?? []).includes(person.id);
                          return (
                            <td key={g.id}>
                              <button
                                type="button"
                                className="bare peg-toggle"
                                aria-pressed={isIn}
                                aria-label={`${person.name} in ${g.name}`}
                                // Only an active member can be added; anyone can be taken out.
                                disabled={busy !== null || (inactive && !isIn)}
                                onClick={() => toggle(g, person, isIn)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <section className="card access-card" aria-labelledby="access-heading">
              <h2 id="access-heading">Who can borrow what</h2>
              <ul className="access-list">
                {restricted.map((a) => (
                  <li key={a.id}>
                    <Link to={ROUTES.asset(a.id)}>{a.name}</Link>
                    <span>
                      {(a.allowedGroups ?? []).length
                        ? a.allowedGroups.map((g) => (
                            <span key={g.id} className="gear-chip">
                              {g.name}
                            </span>
                          ))
                        : 'Nobody: its groups no longer exist'}
                    </span>
                  </li>
                ))}
                <li>
                  <span>{pluralize(assets.length - restricted.length, 'other asset')}</span>
                  <span className="hint">Everyone in the organization</span>
                </li>
              </ul>
              <p className="hint">Restrict an item to groups from its Edit asset page.</p>
            </section>
          </>
        )
      ) : null}

      {creating ? (
        <Drawer
          title="Create a group"
          description="Add its members next, from the grid or the group's own page."
          onClose={() => setCreating(false)}
        >
          <CreateGroupForm onCreated={onCreated} />
        </Drawer>
      ) : null}
    </>
  );
}

# The insert-only database role for the audit collection (SR-8, SCRUM-125)

SDD §6.6 promises audit-log immutability at **two** layers. This document covers the second one.

| Layer | What enforces it | Status |
| --- | --- | --- |
| Application | `auditEvent.repository.js` exposes only `append` and `query`; `models/AuditEvent.js` throws on every mutating Mongoose operation | **Done**, covered by tests in `tests/integration/routes/assetHistory.test.js` and `tests/unit/services/auditEvent.test.js` |
| Database | A custom Atlas role that grants the API's user `find` and `insert` on `auditevents`, and nothing else | **Defined here; not yet applied** — see [Who has to run this](#who-has-to-run-this) |

The point of the second layer is that it holds even when the first one fails. A bug, a careless
refactor, or a successful injection attack cannot rewrite history through the application's
credentials, because those credentials are not permitted to.

## Why a database-wide `readWrite` role will not do

This is the detail that makes the task more than a one-liner, and SDD §6.6 calls it out explicitly.

The obvious approach — grant `readWrite` on the database and then try to subtract the audit
collection — does not work. MongoDB privileges are **additive**: there is no "deny" that overrides a
grant. A database-wide `readWrite` covers every collection in the database, including `auditevents`,
and nothing can carve it back out.

So the grants have to be made **collection by collection**: full read/write on the six ordinary
collections, and a deliberately narrower grant on the seventh.

## The role

Two privileges, applied to the `safedrop` database.

| Collections | Actions | Why |
| --- | --- | --- |
| `organizations`, `users`, `assets`, `assetunits`, `checkoutrequests`, `refreshtokens` | `find`, `insert`, `update`, `remove`, `createIndex` | Ordinary application data the API owns outright |
| `auditevents` | `find`, `insert` | Append and read only. **No `update`, no `remove`.** |

`createIndex` is included on the six because `migrate-mongo` creates indexes as a deploy step with
these credentials. It is deliberately **not** granted on `auditevents`: that collection's indexes are
created once by the migration below, run by an administrative user, so the application never needs to
alter them.

### Create it with `mongosh`

Connect to the cluster as a user with `atlasAdmin` (or any role carrying `createRole` on `admin`),
then:

```javascript
use admin;

db.createRole({
  role: 'safedropApp',
  privileges: [
    {
      resource: { db: 'safedrop', collection: 'organizations' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    {
      resource: { db: 'safedrop', collection: 'users' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    {
      resource: { db: 'safedrop', collection: 'assets' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    {
      resource: { db: 'safedrop', collection: 'assetunits' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    {
      resource: { db: 'safedrop', collection: 'checkoutrequests' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    {
      resource: { db: 'safedrop', collection: 'refreshtokens' },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    },
    // The whole point. find + insert, nothing else (SR-8).
    {
      resource: { db: 'safedrop', collection: 'auditevents' },
      actions: ['find', 'insert'],
    },
  ],
  roles: [],
});
```

### Assign it to the API's user

```javascript
use admin;

// Replace the existing role list entirely — do not add this alongside readWrite, which would
// re-grant update and remove on auditevents and defeat the whole exercise.
db.updateUser('safedrop_api', {
  roles: [{ role: 'safedropApp', db: 'admin' }],
});
```

In the Atlas UI the same thing is **Database Access → the API user → Edit → Built-in Role → Custom
Role → `safedropApp`**, with any previous `readWrite`/`readWriteAnyDatabase` entry removed.

Apply this in **every** environment that has its own cluster or database user — staging and
production both. An environment left on `readWrite` has the application-layer protection only, which
is the situation this ticket exists to end.

### One consequence to plan for

The API user can no longer create indexes on `auditevents`, which is intentional. The existing
migration `20260916000000-initial-indexes.js` does create them, so it must be run **once by an
administrative user** before the API user is narrowed — or run before this role is applied. After
that, migrations touching the other six collections continue to work under the app's own credentials.

Local development via Docker Compose is unaffected: the Compose `mongo` service runs without
authentication, so there are no roles to apply and no behaviour changes.

## Verifying it

Against a deployment where the role has been applied, connected **as the API user**:

```javascript
use safedrop;

// Should succeed: reading and appending are what the role is for.
db.auditevents.find().limit(1);

// Should each fail with "not authorized on safedrop to execute command ...".
db.auditevents.updateOne({}, { $set: { action: 'ASSET_RETURNED' } });
db.auditevents.deleteOne({});
db.auditevents.drop();

// Should still succeed: the other collections are untouched by this change.
db.users.updateOne({}, { $set: { name: 'unchanged by this check' } });
```

The failures are the passing result. If any of the three middle commands succeeds, the user still
holds a database-wide role and the assignment above did not replace it.

The automated form of this check is staged in
`code/backend/tests/integration/security/auditDbRole.test.js`. It is skipped by default: the suite
runs against `mongodb-memory-server`, which has no authentication, so there are no roles to enforce
and the test would pass for the wrong reason. It runs only when pointed at a real authenticated
deployment — see the header of that file.

## Who has to run this

Creating the role and reassigning the user needs Atlas console or Atlas Admin API access, which the
application's own credentials deliberately do not have. Whoever administers the cluster (Configuration
Lead) applies it; this document exists so it can be recreated exactly, and so a cluster rebuilt later
does not quietly come back as `readWrite`.

**Until it is applied, SR-8 rests on the application layer alone.** That layer is real and tested —
but it is one bug away from being the only thing standing between a defect and a rewritten audit
trail, which is the gap SDD §6.6 describes.

## References

- SDD §6.6 (audit-log immutability), §6.10 (SR traceability table)
- SR-8, SR-9, SR-10
- OD-7: the Atlas free tier supports custom database roles, so this needs no paid tier

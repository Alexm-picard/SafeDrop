/**
 * The database half of audit-log immutability (SR-8, SCRUM-125).
 *
 * SDD §6.6 promises immutability at two layers. The application layer is enforced in code and proven
 * elsewhere: `auditEvent.repository.js` exposes only `append` and `query`, and `models/AuditEvent.js`
 * throws on every mutating Mongoose operation. This file covers the other layer — that the API's
 * database user is not *permitted* to modify the audit collection, so a bug or a successful injection
 * cannot rewrite history through the application's own credentials.
 *
 * **Why this is skipped by default, and why that is not a way of avoiding it.** The suite runs against
 * `mongodb-memory-server`, which is started without authentication. There are no users and no roles,
 * so every operation is permitted and these assertions would fail — or, worse, a weaker version of
 * them would *pass* while proving nothing. A test that cannot fail for the right reason is not
 * evidence, so this runs only when pointed at a deployment where the role actually exists.
 *
 * **To run it**, against staging or any cluster where the role from `code/docs/audit-db-role.md` has
 * been applied, using the API's own credentials — not an admin's:
 *
 *   AUDIT_ROLE_TEST_URI='mongodb+srv://safedrop_api:...@cluster/safedrop' \
 *     npx vitest run tests/integration/security/auditDbRole.test.js
 *
 * Passing an administrative connection string makes this fail, which is correct: the question is
 * precisely whether *these* credentials are constrained.
 *
 * The role is not yet applied to any environment (SCRUM-125 needs Atlas console access). Until it is,
 * SR-8 rests on the application layer alone.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const uri = process.env.AUDIT_ROLE_TEST_URI;
/** Only meaningful against a real, authenticated deployment. See the header. */
const describeIfConfigured = uri ? describe : describe.skip;

let connection;
beforeAll(async () => {
  if (uri) {
    connection = await mongoose.createConnection(uri).asPromise();
  }
});
afterAll(async () => {
  await connection?.close();
});

/** The audit collection, reached through the driver so no Mongoose hook can intercept the call. */
const auditevents = () => connection.db.collection('auditevents');

describeIfConfigured('the API user cannot alter the audit collection (SR-8, SCRUM-125)', () => {
  it('may read it', async () => {
    await expect(auditevents().find({}).limit(1).toArray()).resolves.toBeInstanceOf(Array);
  });

  it('may append to it', async () => {
    // Append is the one write the application needs, and losing it would break every audited action.
    const probe = {
      orgId: new mongoose.Types.ObjectId(),
      actorId: new mongoose.Types.ObjectId(),
      actorRole: 'ORG_ADMIN',
      action: 'ORG_CREATED',
      targetType: 'Organization',
      targetId: new mongoose.Types.ObjectId(),
      before: null,
      after: { note: 'SCRUM-125 role probe' },
      timestamp: new Date(),
      requestId: null,
    };
    const result = await auditevents().insertOne(probe);
    expect(result.acknowledged).toBe(true);
    // Deliberately not cleaned up: deleting it is exactly what these credentials must not be able to
    // do, and a cleanup step here would either fail or prove the role is wrong.
  });

  it('may not update an entry', async () => {
    // Driver-level, bypassing Mongoose entirely. The model's hooks are the *application* layer; this
    // asserts the database refuses the operation even when nothing in our code stands in the way.
    await expect(
      auditevents().updateOne({}, { $set: { action: 'ASSET_RETURNED' } }),
    ).rejects.toThrow(/not authorized/i);
  });

  it('may not delete an entry', async () => {
    await expect(auditevents().deleteOne({})).rejects.toThrow(/not authorized/i);
  });

  it('may not drop the collection', async () => {
    // The blunt instrument: refusing updates and deletes would mean little if the whole collection
    // could be removed in one call.
    await expect(auditevents().drop()).rejects.toThrow(/not authorized/i);
  });

  it('still has full write access to the other collections', async () => {
    // The narrowing has to be surgical. If granting the role cost the API write access to ordinary
    // data, the application would be broken in a way no other test here would catch.
    const result = await connection.db
      .collection('users')
      .updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { name: 'no-op' } });
    expect(result.acknowledged).toBe(true);
  });
});

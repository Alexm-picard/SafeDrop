// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (Lab 3 TDD walkthrough; test written before the endpoint exists)
// AI-Assisted Areas: acceptance test for AC2 of the deactivate-member story (a deactivated member cannot log in)
// Human Contributions: reviewed and approved by Amber Rastella (PR #47, 2026-09-28); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Written test-first as part of CS673 Lab 3 (TDD/BDD). This is the RED step: no deactivation
//   field or login check exists yet, so this test is expected to fail until they are added. Structure
//   and assertion style follow tests/integration/routes/auth.test.js's existing POST /api/auth/login
//   suite (same-body comparison instead of a hardcoded message, driver-level fixture writes).

/**
 * AC2 (deactivate-member story, Lab 3 TDD example): `POST /api/auth/login` refuses a deactivated member.
 *
 * This augments the login suite in auth.test.js but lives in its own file, per the Lab 3 brief, since
 * the feature is still being built test-first. The member is deactivated by writing `deactivatedAt`
 * through the native MongoDB driver rather than the Mongoose model — the same "driver-level write" idiom
 * auth.test.js already uses to age immutable fields for a test — because the field does not exist on the
 * `User` schema yet, and there is no `POST /api/users/:id/deactivate` endpoint to do it through. Writing
 * through the driver means the document genuinely holds the field in the database, so a failing test here
 * can only mean `login()` does not check it, never that the fixture write was silently dropped.
 *
 * Like every other login failure, this must be indistinguishable from a wrong password: the same status,
 * the same error code and body, and no session cookies — never revealing that the account exists but is
 * disabled (no account enumeration).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { User } from '../../../src/models/User.js';
import { loginAs } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

/** Compares two error bodies with requestId removed — how auth.test.js proves two failures are identical. */
const stripRequestId = (body) => {
  const clone = structuredClone(body);
  delete clone.error?.requestId;
  return clone;
};

let seed;
beforeEach(async () => {
  resetAuthRateLimiter();
  seed = await seedTwoOrgs();
});

const signIn = (email, password) => loginAs(app, { orgSlug: 'org-a', email, password });

describe('POST /api/auth/login', () => {
  it('refuses a deactivated member with the identical 401 a wrong password gets (AC2)', async () => {
    // Prove the password is genuinely correct before deactivating, so a later failure can only be
    // about deactivation, not a fixture mistake.
    const before = await signIn(seed.a.member.email, seed.password);
    expect(before.res.status).toBe(200);

    // Driver-level write so a field the schema doesn't declare yet can still be set for this test.
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );

    const deactivated = await signIn(seed.a.member.email, seed.password);
    const wrongPassword = await signIn(seed.a.member.email, 'definitely-not-the-password');

    expect(deactivated.res.status).toBe(401);
    expect(deactivated.res.headers['set-cookie']).toBeUndefined();
    expect(deactivated.res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(stripRequestId(deactivated.res.body)).toEqual(stripRequestId(wrongPassword.res.body));
  });
});

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (test-first pairing session; each test written before its production code)
// AI-Assisted Areas: integration tests for unit maintenance (SCRUM-141) — authorisation, state transitions, tenant isolation, audit
// Human Contributions: acceptance criteria, test ordering and the red/green decisions by Mateus Silva
// Notes: Written for Lab 3 (TDD). Every test here was committed red before the code that makes it pass.

/**
 * Integration tests for taking one physical unit out of circulation and putting it back
 * (`POST /api/assets/:id/units/:unitId/maintenance` and `.../maintenance/end`, SCRUM-141).
 *
 * Maintenance is the reversible counterpart to retiring: a broken unit stops being lendable while it
 * is repaired, then comes back. Retiring is permanent, so it is the wrong tool for a repair.
 *
 * The fixture (`seedTwoOrgs`) has a unit ready for every criterion — the laptop's units are
 * REQUESTED, OUT and HELD (all of which must refuse maintenance), and the camera's are AVAILABLE,
 * AVAILABLE and RETIRED.
 *
 * One `it()` per acceptance criterion, so the trail from user story to AC to test is readable
 * top to bottom.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../src/app.js';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

// `append` is wrapped in a spy that still calls through, so the audit tests can read real rows and
// the rollback test can make one write fail. Same pattern as users.test.js and organizations.test.js.
vi.mock('../../../src/repositories/auditEvent.repository.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, append: vi.fn(original.append) };
});

// Likewise for the compare-and-set, so AC4 can force the losing side of the race deterministically
// instead of hoping two real requests collide in the right order.
vi.mock('../../../src/repositories/assetUnit.repository.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, updateStatusIfCurrent: vi.fn(original.updateStatusIfCurrent) };
});

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

// A `...Once` implementation that never fires stays queued and would fire in a later test, failing it
// for a reason that has nothing to do with what it tests. Vitest 5's mockReset restores the
// implementation `vi.fn(impl)` was given, so this both drains the queue and keeps append working.
afterEach(() => {
  auditRepo.append.mockReset();
  assetUnitRepo.updateStatusIfCurrent.mockReset();
});

/** The camera and its first unit, which the seed leaves AVAILABLE — the one legal starting state. */
const availableUnit = (org) => ({
  asset: org.extraAssets[0].asset,
  unit: org.extraAssets[0].units[0],
});

/**
 * A seeded unit already in `status`, with the asset that owns it.
 *
 * The fixture happens to contain one of every status we need to refuse, so AC3 needs no setup of its
 * own: the laptop's three units are REQUESTED, OUT and HELD, and the camera's third is RETIRED.
 * @param {object} org one side of `seedTwoOrgs()`
 * @param {string} status
 * @returns {{ asset: object, unit: object }}
 */
const unitInStatus = (org, status) =>
  ({
    REQUESTED: { asset: org.asset, unit: org.units[0] },
    OUT: { asset: org.asset, unit: org.units[1] },
    HELD: { asset: org.asset, unit: org.units[2] },
    RETIRED: { asset: org.extraAssets[0].asset, unit: org.extraAssets[0].units[2] },
  })[status];

describe('POST /api/assets/:id/units/:unitId/maintenance (SCRUM-141)', () => {
  it('AC5: refuses a MEMBER with 403 — taking stock out of circulation is an admin action', async () => {
    const { asset, unit } = availableUnit(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.member))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('AC1: moves an AVAILABLE unit to MAINTENANCE and returns the updated unit', async () => {
    const { asset, unit } = availableUnit(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: String(unit._id), status: 'MAINTENANCE' });

    // And it stuck: the response is not just an optimistic echo of what was asked for.
    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('MAINTENANCE');
  });

  /**
   * AC3. Each of these is refused for its own reason — someone is holding it (OUT), it is promised
   * to someone (HELD), someone is waiting on a decision (REQUESTED), or it has permanently left the
   * inventory (RETIRED) — but the answer is the same 409 in every case. Only an AVAILABLE unit can
   * be sent for repair.
   */
  it.each(['OUT', 'HELD', 'REQUESTED', 'RETIRED'])(
    'AC3: refuses a %s unit with 409 and leaves its status alone',
    async (status) => {
      const { asset, unit } = unitInStatus(seed.a, status);

      const res = await request(app)
        .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
        .set('Cookie', accessCookieFor(seed.a.admin))
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');

      // A refusal has to be inert: the unit is exactly as it was.
      const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
      expect(stored.status).toBe(status);
    },
  );

  it('AC5: answers 404, never 403, for another organisation’s unit (SR-2)', async () => {
    const { asset, unit } = availableUnit(seed.b);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Nothing moved on the other side of the boundary.
    const untouched = await assetUnitRepo.findById(seed.b.orgId, unit._id);
    expect(untouched.status).toBe('AVAILABLE');
  });

  it('AC5: answers 404 for a unit that belongs to a different asset in the same org', async () => {
    // The camera's AVAILABLE unit, addressed through the laptop. The unit is real, it is in the
    // caller's own organisation, and it is in a state that would otherwise succeed — so only the
    // asset/unit relationship can refuse it.
    const { unit } = availableUnit(seed.a);
    const wrongAsset = seed.a.asset;

    const res = await request(app)
      .post(`/api/assets/${wrongAsset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const untouched = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(untouched.status).toBe('AVAILABLE');
  });

  it('AC5: answers 404 for a unit id that does not exist', async () => {
    const res = await request(app)
      .post(`/api/assets/${seed.a.asset._id}/units/${'0'.repeat(24)}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/assets/:id/units/:unitId/maintenance/end (SCRUM-141)', () => {
  /**
   * Send a unit for repair through the API, so the two endpoints are exercised as the pair an admin
   * actually uses rather than by reaching past the service to set the status directly.
   * @param {object} org one side of `seedTwoOrgs()`
   * @returns {Promise<{ asset: object, unit: object }>}
   */
  async function sendForRepair(org) {
    const { asset, unit } = availableUnit(org);
    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(org.admin))
      .send({});
    expect(res.status).toBe(200);
    return { asset, unit };
  }

  it('AC2: brings a repaired unit back from MAINTENANCE to AVAILABLE', async () => {
    const { asset, unit } = await sendForRepair(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance/end`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: String(unit._id), status: 'AVAILABLE' });

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('AVAILABLE');
  });

  it('AC2: ending maintenance on an already AVAILABLE unit answers 200, not an error', async () => {
    // A double-click, or a second admin who did not see the first one finish. The unit is available,
    // which is what the caller wanted — so this is a no-op, not a failure. The audit trail records
    // state *changes*, not requests, so the second call must not append a second row; that half is
    // pinned by the audit tests once UNIT_MAINTENANCE_ENDED exists (AC6).
    const { asset, unit } = await sendForRepair(seed.a);
    const path = `/api/assets/${asset._id}/units/${unit._id}/maintenance/end`;

    const first = await request(app)
      .post(path)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(path)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: String(unit._id), status: 'AVAILABLE' });
  });

  it('AC2: refuses with 409 to bring a RETIRED unit back into circulation', async () => {
    // Retiring is permanent. Ending maintenance must not become a back door to un-retiring a unit
    // that was written off — and RETIRED never went into maintenance in the first place.
    const { asset, unit } = unitInStatus(seed.a, 'RETIRED');

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance/end`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('RETIRED');
  });
});

describe('the maintenance audit trail (SCRUM-141 AC6)', () => {
  /** Send the camera's AVAILABLE unit for repair and hand back the pair of ids involved. */
  async function sendForRepair(org) {
    const { asset, unit } = { asset: org.extraAssets[0].asset, unit: org.extraAssets[0].units[0] };
    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(org.admin))
      .send({});
    expect(res.status).toBe(200);
    return { asset, unit };
  }

  it('records UNIT_MAINTENANCE_STARTED against the unit, with before and after', async () => {
    const { unit } = await sendForRepair(seed.a);

    const events = await auditRepo.query(seed.a.orgId, { action: 'UNIT_MAINTENANCE_STARTED' });
    expect(events.total).toBe(1);
    expect(events.items[0]).toMatchObject({ targetType: 'AssetUnit' });
    expect(String(events.items[0].targetId)).toBe(String(unit._id));
    expect(String(events.items[0].actorId)).toBe(String(seed.a.admin._id));
    // The snapshot names the transition, so a reader of the trail does not have to know the state
    // machine to see what changed.
    expect(events.items[0].before).toEqual({ status: 'AVAILABLE' });
    expect(events.items[0].after).toEqual({ status: 'MAINTENANCE' });
  });

  it('records UNIT_MAINTENANCE_ENDED when the unit comes back', async () => {
    const { asset, unit } = await sendForRepair(seed.a);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance/end`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(res.status).toBe(200);

    const events = await auditRepo.query(seed.a.orgId, { action: 'UNIT_MAINTENANCE_ENDED' });
    expect(events.total).toBe(1);
    expect(String(events.items[0].targetId)).toBe(String(unit._id));
    expect(events.items[0].before).toEqual({ status: 'MAINTENANCE' });
    expect(events.items[0].after).toEqual({ status: 'AVAILABLE' });
  });

  it('records the end exactly once when it is ended twice', async () => {
    // The other half of the idempotency decision: the second call answers 200 because the caller's
    // goal is met, but nothing changed, so the trail must not claim a second repair finished. The
    // audit log records state changes, not requests.
    const { asset, unit } = await sendForRepair(seed.a);
    const path = `/api/assets/${asset._id}/units/${unit._id}/maintenance/end`;

    await request(app).post(path).set('Cookie', accessCookieFor(seed.a.admin)).send({});
    await request(app).post(path).set('Cookie', accessCookieFor(seed.a.admin)).send({});

    const events = await auditRepo.query(seed.a.orgId, { action: 'UNIT_MAINTENANCE_ENDED' });
    expect(events.total).toBe(1);
  });

  it('leaves the unit AVAILABLE when the audit write fails (OD-2, SR-9)', async () => {
    // The whole point of writing the event inside the transaction: the change and the evidence of it
    // commit together or not at all. Without a transaction the unit would sit in MAINTENANCE with no
    // record of who sent it there.
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));
    const { asset, unit } = {
      asset: seed.a.extraAssets[0].asset,
      unit: seed.a.extraAssets[0].units[0],
    };

    const failed = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(failed.status).toBe(500);

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('AVAILABLE');

    // And nothing half-done blocks a retry.
    const retried = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});
    expect(retried.status).toBe(200);
  });
});

/**
 * AC4, two admins clicking "Start maintenance" at the same moment.
 *
 * **These are regression tests, not TDD evidence, and they passed the first time they ran.** The
 * behaviour arrived as a side effect of AC3: the compare-and-set was already the natural way to write
 * the transition, and AC3's green turned its `null` return into the 409 this criterion asks for. That
 * is worth stating plainly rather than presenting them as a red that never happened — a test that
 * passes immediately means either the behaviour exists or the test is wrong, and here it is the first.
 *
 * **The two tests are not equally strong, and this was measured rather than assumed.** Rewriting the
 * service the naive way — read the status, check it, then write unconditionally — and running this
 * file leaves the concurrent test below *passing* and fails only the mechanism test. The reason is
 * that the read-then-write happens inside a transaction: the second writer hits a MongoDB write
 * conflict, `session.withTransaction` retries its callback, and the retry then sees MAINTENANCE and
 * refuses. So the outcome is protected twice over, and a test that only checks the outcome cannot
 * tell the two implementations apart.
 *
 * That makes the compare-and-set the mechanism the ticket asks for and the one that still holds if
 * the transaction is ever removed — and the second test the only one that notices if it goes away.
 */
describe('two admins racing for the same unit (SCRUM-141 AC4)', () => {
  it('exactly one of two simultaneous requests wins, and the trail records one start', async () => {
    const { asset, unit } = availableUnit(seed.a);
    const path = `/api/assets/${asset._id}/units/${unit._id}/maintenance`;

    // The realistic shape of the race: two requests in flight at once, nothing coordinating them.
    const [first, second] = await Promise.all([
      request(app).post(path).set('Cookie', accessCookieFor(seed.a.admin)).send({}),
      request(app).post(path).set('Cookie', accessCookieFor(seed.a.admin)).send({}),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('MAINTENANCE');

    // One change, one row. Two winners would show up here as two.
    const events = await auditRepo.query(seed.a.orgId, { action: 'UNIT_MAINTENANCE_STARTED' });
    expect(events.total).toBe(1);
  });

  it('losing the compare-and-set is a 409, and the write really is conditional', async () => {
    // The test above proves the outcome but not the mechanism: MongoDB might serialise two requests
    // so tidily that a read-then-write would also survive it. So this one forces the losing side —
    // the conditional write reports it matched nothing, which is exactly what the admin who lost sees
    // — and then checks what the service did with that answer.
    const { asset, unit } = availableUnit(seed.a);
    assetUnitRepo.updateStatusIfCurrent.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`/api/assets/${asset._id}/units/${unit._id}/maintenance`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    // The mechanism itself: the write is guarded by the status it expects, and it runs inside the
    // transaction. An unconditional updateStatus would satisfy the happy path and lose the race.
    expect(assetUnitRepo.updateStatusIfCurrent).toHaveBeenCalledWith(
      seed.a.orgId,
      String(unit._id),
      { from: 'AVAILABLE', to: 'MAINTENANCE' },
      expect.objectContaining({ session: expect.anything() }),
    );

    // The loser changes nothing and records nothing.
    const stored = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(stored.status).toBe('AVAILABLE');
    const events = await auditRepo.query(seed.a.orgId, { action: 'UNIT_MAINTENANCE_STARTED' });
    expect(events.total).toBe(0);
  });
});

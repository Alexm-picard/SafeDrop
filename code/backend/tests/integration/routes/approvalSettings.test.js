// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~85% (acceptance tests written from the story before any production code)
// AI-Assisted Areas: integration tests for configurable approval (SCRUM-148) — AT-1..AT-4, validation, tenant isolation, handoff
// Human Contributions: user story, acceptance criteria and the "auto-approved still waits for handoff" decision by Orelmis Toribio; reviewed and approved by Alex Picard (PR #52, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Committed red first (501 stub, policy always requiring approval), then made green by the implementation.

/**
 * Acceptance tests for configurable approval (SCRUM-148).
 *
 * An Org Admin chooses whether checkout requests need an approver, as an organisation-wide default
 * (`PATCH /api/organizations/me/approval-settings`) that individual assets can override
 * (`approvalMode` on `PATCH /api/assets/:id`). Resolution is asset → organisation → REQUIRED.
 *
 * Team decision on open question 1: an auto-approved request stops at APPROVED with its unit HELD.
 * It does **not** go straight to CHECKED_OUT, because handing the item over is still a physical event
 * that someone with `requests:handoff` records (SCRUM-120). The AT-1 block pins that.
 *
 * Fixture roles (seedTwoOrgs): the camera stands in for the story's cheap "USB-C Charger" and the
 * projector for the "Canon EOS R6"; both have an AVAILABLE unit at index 0.
 *
 * Arrangement writes the modes straight to the models rather than through the API, so a failure in
 * one AT points at that AT's behaviour, not at the settings endpoint every test would otherwise
 * depend on. The endpoint itself is exercised by AT-3 and AT-4.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../../src/app.js';
import { Asset } from '../../../src/models/Asset.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { Organization } from '../../../src/models/Organization.js';
import { User } from '../../../src/models/User.js';
import { down, up } from '../../../migrations/20261002000000-approval-settings.js';
import mongoose from 'mongoose';
import * as assetUnitRepo from '../../../src/repositories/assetUnit.repository.js';
import * as checkoutRequestRepo from '../../../src/repositories/checkoutRequest.repository.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { accessCookieFor } from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

const SETTINGS_PATH = '/api/organizations/me/approval-settings';

/** Set an organisation's default directly, bypassing the API (arrangement only). */
const setOrgDefault = (org, defaultMode) =>
  Organization.updateOne(
    { _id: org.orgId },
    { $set: { 'approvalSettings.defaultMode': defaultMode } },
  );

/** Set an asset's override directly, bypassing the API (arrangement only). */
const setAssetMode = (asset, approvalMode) =>
  Asset.updateOne({ _id: asset._id }, { $set: { approvalMode } });

const charger = (org) => ({ asset: org.extraAssets[0].asset, unit: org.extraAssets[0].units[0] });
const camera = (org) => ({ asset: org.extraAssets[1].asset, unit: org.extraAssets[1].units[0] });

/** Submit a request for `unit` as `user`, the way the Browse screen does. */
const submit = (user, unit) =>
  request(app).post('/api/requests').set('Cookie', accessCookieFor(user)).send({
    unitId: unit._id,
    neededFrom: '2026-11-01T00:00:00.000Z',
    neededTo: '2026-11-05T00:00:00.000Z',
  });

const auditFor = (org, action) => AuditEvent.find({ orgId: org.orgId, action }).lean();

describe('AT-1: a per-asset AUTO override skips approval (SCRUM-148)', () => {
  beforeEach(async () => {
    await setOrgDefault(seed.a, 'REQUIRED');
    await setAssetMode(charger(seed.a).asset, 'AUTO');
  });

  it('creates the request directly in APPROVED and moves the unit to HELD', async () => {
    const { unit } = charger(seed.a);

    const res = await submit(seed.a.member, unit);

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('APPROVED');
    // No human decided it, and nothing pretends one did.
    expect(res.body.decidedBy ?? null).toBeNull();

    const storedUnit = await assetUnitRepo.findById(seed.a.orgId, unit._id);
    expect(storedUnit.status).toBe('HELD');
  });

  it('records REQUEST_AUTO_APPROVED naming the policy, with no human approver', async () => {
    const res = await submit(seed.a.member, charger(seed.a).unit);

    const events = await auditFor(seed.a, AUDIT_ACTION.REQUEST_AUTO_APPROVED);
    expect(events).toHaveLength(1);
    expect(String(events[0].targetId)).toBe(res.body.id);
    expect(events[0].after).toMatchObject({ state: 'APPROVED', policy: 'configurable-approval' });
    // The actor is the requester who submitted, never an approver: there wasn't one.
    expect(String(events[0].actorId)).toBe(String(seed.a.member._id));
    expect(await auditFor(seed.a, AUDIT_ACTION.REQUEST_APPROVED)).toHaveLength(0);
  });

  it('does not appear in the approver queue', async () => {
    const res = await submit(seed.a.member, charger(seed.a).unit);

    const queue = await request(app)
      .get('/api/requests?scope=org&state=PENDING')
      .set('Cookie', accessCookieFor(seed.a.approver));

    expect(queue.status).toBe(200);
    expect(queue.body.items.map((r) => r.id)).not.toContain(res.body.id);
  });

  it('the request detail shows the approval as automatic, not as a person’s decision', async () => {
    const res = await submit(seed.a.member, charger(seed.a).unit);

    const detail = await request(app)
      .get(`/api/requests/${res.body.id}`)
      .set('Cookie', accessCookieFor(seed.a.member));

    expect(detail.status).toBe(200);
    expect(detail.body.request.autoApproved).toBe(true);
    expect(detail.body.decidedBy).toBeNull();
    expect(detail.body.timeline.map((e) => e.event)).toEqual(['SUBMITTED', 'AUTO_APPROVED']);
  });

  // Team decision on open question 1: auto-approval skips the decision, not the handoff.
  it('stops at APPROVED and still needs the physical handoff to reach CHECKED_OUT', async () => {
    const res = await submit(seed.a.member, charger(seed.a).unit);
    expect(res.body.state).not.toBe('CHECKED_OUT');

    const handoff = await request(app)
      .post(`/api/requests/${res.body.id}/checkout`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});

    expect(handoff.status).toBe(200);
    expect(handoff.body.state).toBe('CHECKED_OUT');
  });
});

describe('AT-2: a per-asset REQUIRED override forces approval (SCRUM-148)', () => {
  beforeEach(async () => {
    await setOrgDefault(seed.a, 'AUTO');
    await setAssetMode(camera(seed.a).asset, 'REQUIRED');
  });

  it('leaves the request PENDING and puts it in the approver queue', async () => {
    const { unit } = camera(seed.a);

    const res = await submit(seed.a.member, unit);

    expect(res.status).toBe(201);
    expect(res.body.state).toBe('PENDING');
    expect((await assetUnitRepo.findById(seed.a.orgId, unit._id)).status).toBe('REQUESTED');

    const queue = await request(app)
      .get('/api/requests?scope=org&state=PENDING')
      .set('Cookie', accessCookieFor(seed.a.approver));
    expect(queue.body.items.map((r) => r.id)).toContain(res.body.id);
    expect(await auditFor(seed.a, AUDIT_ACTION.REQUEST_AUTO_APPROVED)).toHaveLength(0);
  });

  it('still refuses to let the requester approve their own request', async () => {
    // An approver files a request, then tries to approve it: separation of duties survives.
    const res = await submit(seed.a.approver, camera(seed.a).unit);
    expect(res.body.state).toBe('PENDING');

    const approve = await request(app)
      .post(`/api/requests/${res.body.id}/approve`)
      .set('Cookie', accessCookieFor(seed.a.approver))
      .send({});

    expect(approve.status).toBe(403);
    expect((await checkoutRequestRepo.findById(seed.a.orgId, res.body.id)).state).toBe('PENDING');
  });

  // The other half of the org-default rule: with no override, AUTO applies.
  it('an INHERIT asset in an AUTO organisation is auto-approved', async () => {
    const res = await submit(seed.a.member, charger(seed.a).unit);
    expect(res.body.state).toBe('APPROVED');
  });
});

describe('AT-3: only Org Admins can change the rules (SCRUM-148)', () => {
  it.each(['member', 'approver'])(
    'a %s gets 403 from PATCH approval-settings and the default is unchanged',
    async (who) => {
      const res = await request(app)
        .patch(SETTINGS_PATH)
        .set('Cookie', accessCookieFor(seed.a[who]))
        .send({ defaultMode: 'AUTO' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      const org = await Organization.findById(seed.a.orgId).lean();
      expect(org.approvalSettings.defaultMode).toBe('REQUIRED');
    },
  );

  it.each(['member', 'approver'])(
    'a %s gets 403 setting approvalMode on an asset and the asset is unchanged',
    async (who) => {
      const { asset } = charger(seed.a);

      const res = await request(app)
        .patch(`/api/assets/${asset._id}`)
        .set('Cookie', accessCookieFor(seed.a[who]))
        .send({ approvalMode: 'AUTO' });

      expect(res.status).toBe(403);
      expect((await Asset.findById(asset._id).lean()).approvalMode).toBe('INHERIT');
    },
  );

  it('an Org Admin can set an asset override, and it is stored', async () => {
    const { asset } = charger(seed.a);

    const res = await request(app)
      .patch(`/api/assets/${asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ approvalMode: 'AUTO' });

    expect(res.status).toBe(200);
    expect(res.body.approvalMode).toBe('AUTO');
    expect((await Asset.findById(asset._id).lean()).approvalMode).toBe('AUTO');
  });

  it('an Org Admin can set the organisation default and gets the settings back', async () => {
    const res = await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ defaultMode: 'AUTO' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ defaultMode: 'AUTO' });
    expect((await Organization.findById(seed.a.orgId).lean()).approvalSettings.defaultMode).toBe(
      'AUTO',
    );
  });

  it.each([
    [{ defaultMode: 'INHERIT' }, 'INHERIT is an asset value, not an org default'],
    [{ defaultMode: 'auto' }, 'modes are case-sensitive'],
    [{}, 'defaultMode is required'],
  ])('rejects %j with 400 (%s)', async (body) => {
    const res = await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send(body);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown asset approvalMode with 400', async () => {
    const res = await request(app)
      .patch(`/api/assets/${charger(seed.a).asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ approvalMode: 'SOMETIMES' });
    expect(res.status).toBe(400);
  });

  it('a demoted admin whose token still says ORG_ADMIN is refused, and nothing changes', async () => {
    await User.updateOne({ _id: seed.a.admin._id }, { $set: { role: 'MEMBER' } });

    const res = await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin)) // token minted with the old ORG_ADMIN role
      .send({ defaultMode: 'AUTO' });

    expect(res.status).toBe(403);
    expect((await Organization.findById(seed.a.orgId).lean()).approvalSettings.defaultMode).toBe(
      'REQUIRED',
    );
    expect(await auditFor(seed.a, AUDIT_ACTION.ORG_SETTINGS_UPDATED)).toHaveLength(0);
  });

  it('GET returns the current default to an Org Admin and 403 to everyone else', async () => {
    await setOrgDefault(seed.a, 'AUTO');

    const asAdmin = await request(app)
      .get(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toEqual({ defaultMode: 'AUTO' });

    for (const who of ['member', 'approver']) {
      const res = await request(app).get(SETTINGS_PATH).set('Cookie', accessCookieFor(seed.a[who]));
      expect(res.status).toBe(403);
    }
  });

  it('an asset created without approvalMode inherits; one created with it keeps it', async () => {
    const plain = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'HDMI cable', category: 'cable' });
    expect(plain.status).toBe(201);
    expect(plain.body.approvalMode).toBe('INHERIT');

    const auto = await request(app)
      .post('/api/assets')
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ name: 'USB-C Charger', category: 'charger', approvalMode: 'AUTO' });
    expect(auto.status).toBe(201);
    expect(auto.body.approvalMode).toBe('AUTO');
  });

  it("changes only the caller's organisation (SR-2)", async () => {
    await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ defaultMode: 'AUTO' });

    const orgB = await Organization.findById(seed.b.orgId).lean();
    expect(orgB.approvalSettings.defaultMode).toBe('REQUIRED');
  });
});

describe('AT-4: changes are audited and not retroactive (SCRUM-148)', () => {
  it('records ORG_SETTINGS_UPDATED with before/after and leaves PENDING requests alone', async () => {
    // Two PENDING requests: the fixture's laptop request, and one submitted now under REQUIRED.
    const second = await submit(seed.a.member, charger(seed.a).unit);
    expect(second.body.state).toBe('PENDING');
    const pendingIds = [String(seed.a.request._id), second.body.id];

    const res = await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ defaultMode: 'AUTO' });
    expect(res.status).toBe(200);

    const events = await auditFor(seed.a, AUDIT_ACTION.ORG_SETTINGS_UPDATED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      before: { approvalSettings: { defaultMode: 'REQUIRED' } },
      after: { approvalSettings: { defaultMode: 'AUTO' } },
    });
    expect(String(events[0].actorId)).toBe(String(seed.a.admin._id));
    expect(String(events[0].targetId)).toBe(seed.a.orgId);

    for (const id of pendingIds) {
      expect((await checkoutRequestRepo.findById(seed.a.orgId, id)).state).toBe('PENDING');
    }
  });

  it('applies the new rule to requests submitted afterwards', async () => {
    await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ defaultMode: 'AUTO' });

    const res = await submit(seed.a.member, camera(seed.a).unit);
    expect(res.body.state).toBe('APPROVED');
  });

  it('saving the same value again is not a change and records nothing', async () => {
    const res = await request(app)
      .patch(SETTINGS_PATH)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ defaultMode: 'REQUIRED' });

    expect(res.status).toBe(200);
    expect(await auditFor(seed.a, AUDIT_ACTION.ORG_SETTINGS_UPDATED)).toHaveLength(0);
  });

  it('changing an asset approvalMode records ASSET_UPDATED with the before/after mode', async () => {
    const { asset } = charger(seed.a);

    await request(app)
      .patch(`/api/assets/${asset._id}`)
      .set('Cookie', accessCookieFor(seed.a.admin))
      .send({ approvalMode: 'AUTO' });

    const events = await auditFor(seed.a, AUDIT_ACTION.ASSET_UPDATED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      before: { approvalMode: 'INHERIT' },
      after: { approvalMode: 'AUTO' },
    });
  });
});

describe('SCRUM-148 migration', () => {
  // Raw driver writes: the point is documents that predate the schema fields, which Mongoose would
  // otherwise fill in with defaults on the way in.
  const db = () => mongoose.connection.db;
  const rawOrg = (doc) => db().collection('organizations').findOne({ _id: doc.insertedId });
  const rawAsset = (doc) => db().collection('assets').findOne({ _id: doc.insertedId });
  const insertOldOrg = () =>
    db().collection('organizations').insertOne({ name: 'Old org', slug: 'old-org' });
  const insertOldAsset = () =>
    db()
      .collection('assets')
      .insertOne({ orgId: new mongoose.Types.ObjectId(), name: 'Old asset', category: 'x' });

  it('sets approvalSettings.defaultMode = REQUIRED on organisations that lack it', async () => {
    const inserted = await insertOldOrg();
    await up(db());
    expect((await rawOrg(inserted)).approvalSettings).toEqual({ defaultMode: 'REQUIRED' });
  });

  it('sets approvalMode = INHERIT on assets that lack it', async () => {
    const inserted = await insertOldAsset();
    await up(db());
    expect((await rawAsset(inserted)).approvalMode).toBe('INHERIT');
  });

  it('never overwrites a value an admin already chose', async () => {
    await setOrgDefault(seed.a, 'AUTO');
    await setAssetMode(charger(seed.a).asset, 'AUTO');
    await up(db());
    expect((await Organization.findById(seed.a.orgId).lean()).approvalSettings.defaultMode).toBe(
      'AUTO',
    );
    expect((await Asset.findById(charger(seed.a).asset._id).lean()).approvalMode).toBe('AUTO');
  });

  it('down() removes both fields', async () => {
    const org = await insertOldOrg();
    const asset = await insertOldAsset();
    await up(db());
    await down(db());
    expect((await rawOrg(org)).approvalSettings).toBeUndefined();
    expect((await rawAsset(asset)).approvalMode).toBeUndefined();
  });
});

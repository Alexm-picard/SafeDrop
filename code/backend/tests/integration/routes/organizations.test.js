// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: SCRUM-101 organisation bootstrap: org + first admin + ORG_CREATED audit in one transaction; validation creates nothing
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Integration tests for `POST /api/organizations` (SCRUM-101), the public bootstrap route.
 *
 * Proves that one call creates an organisation, its first ORG_ADMIN and an ORG_CREATED audit event,
 * and signs the admin in.
 *
 * The transaction test is the important one: when the audit write is made to fail, *nothing* is
 * left behind — no organisation, no user (OD-2). Without that, a failure could produce a tenant whose
 * creation was never recorded. The suite also covers duplicate slugs (409) and names that cannot
 * become a slug at all.
 */
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from '../../../src/app.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { Organization } from '../../../src/models/Organization.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../../src/utils/tokens.js';
import { parseSetCookies } from '../../helpers/authAs.js';

vi.mock('../../../src/repositories/auditEvent.repository.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, append: vi.fn(original.append) };
});

const valid = () => ({
  orgName: 'Acme Robotics',
  adminName: 'Ada Admin',
  adminEmail: 'Ada@Acme.test',
  adminPassword: 'Correct-Horse-Battery-9',
});

const countAll = async () => ({
  orgs: await Organization.countDocuments(),
  users: await User.countDocuments(),
  audits: await AuditEvent.countDocuments(),
  tokens: await RefreshToken.countDocuments(),
});

describe('POST /api/organizations (SCRUM-101)', () => {
  it('creates the organisation, its first ORG_ADMIN and an ORG_CREATED audit event, and logs the admin in', async () => {
    const res = await request(app).post('/api/organizations').send(valid());
    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({ name: 'Acme Robotics', slug: 'acme-robotics' });
    expect(res.body.user).toMatchObject({
      email: 'ada@acme.test',
      name: 'Ada Admin',
      role: 'ORG_ADMIN',
    });
    expect(res.body.user.orgId).toBe(res.body.organization.id);
    expect(res.body.user.passwordHash).toBeUndefined();

    const cookies = parseSetCookies(res);
    expect(cookies[ACCESS_COOKIE].attributes.httponly).toBe(true);
    expect(cookies[REFRESH_COOKIE].attributes.path).toBe('/api/auth');

    expect(await countAll()).toEqual({ orgs: 1, users: 1, audits: 1, tokens: 1 });
    const audit = await AuditEvent.findOne();
    expect(audit).toMatchObject({
      action: 'ORG_CREATED',
      actorRole: 'ORG_ADMIN',
      targetType: 'Organization',
    });
    expect(String(audit.targetId)).toBe(res.body.organization.id);
    expect(String(audit.actorId)).toBe(res.body.user.id);
    expect(String(audit.orgId)).toBe(res.body.organization.id);
    expect(audit.requestId).toBe(res.headers['x-request-id']);
    expect(audit.before).toBeNull();
    expect(audit.after).toMatchObject({ slug: 'acme-robotics' });

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE}=${cookies[ACCESS_COOKIE].value}`);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('ORG_ADMIN');
  });

  it.each([
    ['missing password', { ...valid(), adminPassword: undefined }, 'adminPassword'],
    ['short password', { ...valid(), adminPassword: 'short' }, 'adminPassword'],
    ['password over 72 bytes', { ...valid(), adminPassword: 'x'.repeat(73) }, 'adminPassword'],
    ['bad email', { ...valid(), adminEmail: 'not-an-email' }, 'adminEmail'],
    ['org name too short', { ...valid(), orgName: 'A' }, 'orgName'],
    ['unknown key', { ...valid(), role: 'ORG_ADMIN' }, ''],
    [
      'smuggled orgId is stripped then everything else validated',
      { ...valid(), orgId: '0'.repeat(24), adminName: '' },
      'adminName',
    ],
  ])('%s → 400 with field-level detail and creates nothing', async (_label, body, field) => {
    const res = await request(app).post('/api/organizations').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.path === field)).toBe(true);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await countAll()).toEqual({ orgs: 0, users: 0, audits: 0, tokens: 0 });
  });

  it('accepts a two-character name such as "BU" and its admin can log in with slug "bu"', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ ...valid(), orgName: 'BU' });
    expect(res.status).toBe(201);
    expect(res.body.organization.slug).toBe('bu');

    const login = await request(app).post('/api/auth/login').send({
      orgSlug: 'bu',
      email: valid().adminEmail,
      password: valid().adminPassword,
    });
    expect(login.status).toBe(200);
  });

  it('rejects a second organisation with the same slug with 409', async () => {
    await request(app).post('/api/organizations').send(valid());
    const res = await request(app)
      .post('/api/organizations')
      .send({ ...valid(), orgName: 'ACME   Robotics!' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await countAll()).toEqual({ orgs: 1, users: 1, audits: 1, tokens: 1 });
  });

  it('rolls back the organisation and admin when the audit write fails (OD-2 transaction)', async () => {
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));
    const res = await request(app).post('/api/organizations').send(valid());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).not.toContain('simulated');
    expect(await countAll()).toEqual({ orgs: 0, users: 0, audits: 0, tokens: 0 });
  });
});

describe('POST /api/organizations: names that cannot become a slug', () => {
  it.each(['!!', '--', '日本語'])(
    '%s → 400 with an orgName detail, creates nothing',
    async (name) => {
      const res = await request(app)
        .post('/api/organizations')
        .send({ ...valid(), orgName: name });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d) => d.path === 'orgName')).toBe(true);
      expect(await countAll()).toEqual({ orgs: 0, users: 0, audits: 0, tokens: 0 });
    },
  );
});

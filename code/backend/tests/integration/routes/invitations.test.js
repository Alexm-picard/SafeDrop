// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the emailed-invitation request)
// AI-Assisted Areas: acceptance and security tests for the emailed one-time invitation link: email content, accept-invite, 72-hour expiry, single use, resend
// Human Contributions: pending team review
// Notes: The single-use, expiry, resend-invalidation and rollback tests were checked to fail when the behaviour they guard is removed. Must be reviewed by the owning team member before merge.

/**
 * Integration tests for the invitation flow: an admin invites someone, the invitee is emailed a
 * one-time link, opens it to choose their own password, and is signed in.
 *
 * Mail goes through nodemailer's real JSON transport, which builds the message exactly as SMTP would
 * and delivers it to memory — so what is asserted is what would actually have been sent, headers
 * included, with no mail server.
 *
 * The claims that matter, each with its own tests:
 *  - **The admin never learns the password.** Nothing in any response carries the link or a token; the
 *    invitee chooses the password themselves and only its hash is stored.
 *  - **The link is single-use**, enforced by the database, including when it is opened twice at once.
 *  - **It expires** after `INVITE_TTL` (72 hours), and an expired link is told apart from an unknown one.
 *  - **Resending replaces it**: the old link stops working the moment a new one is issued, and a
 *    resend to someone who has already accepted is refused.
 *  - **The token is a credential and is handled like one**: 256 random bits, stored only as a hash,
 *    absent from the audit trail, and guesses at it count against the auth rate limit.
 */
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../src/app.js';
import { resetAuthRateLimiter } from '../../../src/middleware/rateLimit.js';
import { AuditEvent } from '../../../src/models/AuditEvent.js';
import { RefreshToken } from '../../../src/models/RefreshToken.js';
import { User } from '../../../src/models/User.js';
import * as auditRepo from '../../../src/repositories/auditEvent.repository.js';
import { setMailTransport } from '../../../src/services/email.service.js';
import { AUDIT_ACTION } from '../../../src/utils/constants.js';
import { ROLES } from '../../../src/utils/permissions.js';
import { hashToken } from '../../../src/utils/tokens.js';
import {
  accessCookieFor,
  cookieHeaderFrom,
  loginAs,
  parseSetCookies,
} from '../../helpers/authAs.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

vi.mock('../../../src/repositories/auditEvent.repository.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, append: vi.fn(original.append) };
});

/** Messages "sent" so far: what was asked of the mailer, and what nodemailer built from it. */
let mail;
let seed;

beforeEach(async () => {
  resetAuthRateLimiter();
  mail = [];
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const send = transport.sendMail.bind(transport);
  transport.sendMail = async (message) => {
    const info = await send(message);
    mail.push({ input: message, output: JSON.parse(info.message) });
    return info;
  };
  setMailTransport(transport);
  seed = await seedTwoOrgs();
});
afterEach(() => setMailTransport(undefined));

const CHOSEN = 'My-Own-Chosen-Passw0rd';
const asAdminA = () => accessCookieFor(seed.a.admin);
const invite = (body, cookie = asAdminA()) =>
  request(app).post('/api/users/invite').set('Cookie', cookie).send(body);
const resend = (userId, cookie = asAdminA()) =>
  request(app).post(`/api/users/${userId}/resend-invite`).set('Cookie', cookie).send({});
const accept = (token, password = CHOSEN) =>
  request(app).post('/api/auth/accept-invite').send({ token, password });
const listUsers = () => request(app).get('/api/users?limit=100').set('Cookie', asAdminA());

/** The raw token from the link in a sent message: exactly what the invitee would click. */
const tokenIn = (message) => /accept-invite\?token=([\w-]+)/.exec(message.input.text)?.[1];
const lastToken = () => tokenIn(mail.at(-1));
const newMember = { email: 'new.hire@a.test', name: 'New Hire' };
const stored = (email) =>
  User.findOne({ orgId: seed.a.orgId, email }).select('+passwordHash +inviteTokenHash');
/** Move an invitation's expiry, as time passing would. */
const setExpiry = (email, when) =>
  User.updateOne({ orgId: seed.a.orgId, email }, { $set: { inviteExpiresAt: when } });

describe('the invitation email', () => {
  it('goes to the invitee with a one-time link, the expiry, and how to sign in next time', async () => {
    const res = await invite(newMember);

    expect(res.status).toBe(201);
    expect(res.body.delivery).toBe('email');
    expect(mail).toHaveLength(1);
    const { input, output } = mail[0];
    expect(input.to).toEqual({ name: 'New Hire', address: 'new.hire@a.test' });
    expect(input.subject).toBe('Admin a invited you to Org A on SafeDrop');
    // The link: the SPA's address, the accept page, and a 256-bit token (43 base64url characters).
    expect(input.text).toMatch(
      /http:\/\/localhost:5173\/accept-invite\?token=[A-Za-z0-9_-]{43}(?=\s|$)/,
    );
    // When it stops working, and that it is single-use.
    expect(input.text).toContain(new Date(res.body.user.invitation.expiresAt).toUTCString());
    expect(input.text).toMatch(/works once/i);
    // A new member has no reason to know the organisation code, and login needs it.
    expect(input.text).toContain('organization code "org-a"');
    expect(input.text).toContain('http://localhost:5173/login');
    // The HTML alternative carries the same link.
    expect(input.html).toContain(`accept-invite?token=${lastToken()}`);
    expect(output.to[0].address).toBe('new.hire@a.test');
  });

  it('carries a token that matches only the stored hash, never the token itself', async () => {
    await invite(newMember);
    const token = lastToken();
    const user = await stored(newMember.email);

    expect(user.inviteTokenHash).toBe(hashToken(token));
    expect(user.inviteTokenHash).not.toBe(token);
    // Nowhere in the user document is the raw token kept.
    expect(JSON.stringify(user.toObject({ virtuals: false }))).not.toContain(token);
    expect(user.passwordHash).not.toContain(token);
  });

  it('gives each invitation its own token', async () => {
    await invite(newMember);
    await invite({ email: 'second@a.test', name: 'Second' });
    expect(tokenIn(mail[0])).not.toBe(tokenIn(mail[1]));
  });

  it('escapes the invitee’s name in the HTML body', async () => {
    await invite({ email: 'x@a.test', name: '<script>alert(1)</script>' });
    const { html } = mail[0].input;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('cannot be used to add recipients through the invitee’s name', async () => {
    await invite({ email: 'x@a.test', name: 'Eve\r\nBcc: attacker@evil.test' });

    expect(mail).toHaveLength(1);
    const built = JSON.stringify(mail[0].output);
    expect(built).not.toContain('"bcc"');
    expect(built).not.toContain('"cc"');
    expect(mail[0].output.to).toHaveLength(1);
    expect(mail[0].output.to[0].address).toBe('x@a.test');
  });

  it('still creates the invitation when the email cannot be sent, and says so', async () => {
    setMailTransport({
      sendMail: async () => {
        throw new Error('SMTP connection refused');
      },
    });

    const res = await invite(newMember);

    expect(res.status).toBe(201);
    expect(res.body.delivery).toBe('failed');
    expect(res.body.user.invitation.status).toBe('PENDING');
    expect(JSON.stringify(res.body)).not.toMatch(/SMTP|refused|token/i);
    expect(await stored(newMember.email)).not.toBeNull();
  });

  it('sends nothing when the invitation is refused', async () => {
    await invite({ email: seed.a.member.email, name: 'Dup' });
    await invite({ email: 'not-an-email', name: 'X' });
    expect(mail).toHaveLength(0);
  });

  it('sends nothing when the audit write fails and the invitation rolls back (OD-2)', async () => {
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));
    const res = await invite(newMember);
    expect(res.status).toBe(500);
    expect(mail).toHaveLength(0);
  });
});

describe('POST /api/auth/accept-invite', () => {
  it('lets the invitee choose their password, signs them in, and tells them their organisation', async () => {
    await invite(newMember);
    const res = await accept(lastToken());

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: newMember.email,
      role: ROLES.MEMBER,
      orgId: seed.a.orgId,
      invitation: null,
    });
    // Signing in later needs the organisation code, so the SPA is told it.
    expect(res.body.organization).toMatchObject({ name: 'Org A', slug: 'org-a' });
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${CHOSEN}|passwordHash|token`, 'i'));

    // They are signed in: the cookies work.
    const cookies = parseSetCookies(res);
    expect(Object.keys(cookies).sort()).toEqual(['sd_access', 'sd_refresh']);
    const assets = await request(app).get('/api/assets').set('Cookie', cookieHeaderFrom(res));
    expect(assets.status).toBe(200);
  });

  it('stores only a hash of the chosen password and clears the token, so nobody can read it back', async () => {
    await invite(newMember);
    const token = lastToken();
    await accept(token);

    const user = await stored(newMember.email);
    expect(await bcrypt.compare(CHOSEN, user.passwordHash)).toBe(true);
    expect(user.passwordHash).not.toContain(CHOSEN);
    expect(user.inviteTokenHash).toBeUndefined();
    expect(user.inviteExpiresAt).toBeUndefined();
  });

  it('gives the member the password they chose for every later sign-in', async () => {
    await invite(newMember);
    await accept(lastToken());
    const { res } = await loginAs(app, {
      orgSlug: 'org-a',
      email: newMember.email,
      password: CHOSEN,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.invitation).toBeNull();
  });

  it('keeps the role the admin invited them with', async () => {
    await invite({ email: 'ann@a.test', name: 'Ann', role: ROLES.APPROVER });
    await invite({ email: 'root@a.test', name: 'Root', role: ROLES.ORG_ADMIN });

    const ann = await accept(tokenIn(mail[0]));
    const root = await accept(tokenIn(mail[1]));

    expect(ann.body.user.role).toBe(ROLES.APPROVER);
    expect(root.body.user.role).toBe(ROLES.ORG_ADMIN);
    // An invited admin holds real authority the moment they accept; an approver does not.
    expect(
      (await request(app).get('/api/users').set('Cookie', cookieHeaderFrom(root))).status,
    ).toBe(200);
    expect((await request(app).get('/api/users').set('Cookie', cookieHeaderFrom(ann))).status).toBe(
      403,
    );
  });

  it('works only once: a second use is refused and changes nothing', async () => {
    await invite(newMember);
    const token = lastToken();
    expect((await accept(token, CHOSEN)).status).toBe(200);

    const again = await accept(token, 'Someone-Elses-Passw0rd');

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVITATION_INVALID');
    // Still the first password: a replayed link cannot take the account over.
    const user = await stored(newMember.email);
    expect(await bcrypt.compare(CHOSEN, user.passwordHash)).toBe(true);
    expect(
      (
        await loginAs(app, {
          orgSlug: 'org-a',
          email: newMember.email,
          password: 'Someone-Elses-Passw0rd',
        })
      ).res.status,
    ).toBe(401);
  });

  it('lets exactly one of two simultaneous uses of the same link succeed', async () => {
    await invite(newMember);
    const token = lastToken();

    const [one, two] = await Promise.all([
      accept(token, 'First-Chosen-Passw0rd'),
      accept(token, 'Second-Chosen-Passw0rd'),
    ]);

    expect([one.status, two.status].sort()).toEqual([200, 400]);
    const winner = one.status === 200 ? 'First-Chosen-Passw0rd' : 'Second-Chosen-Passw0rd';
    expect(await bcrypt.compare(winner, (await stored(newMember.email)).passwordHash)).toBe(true);
    // One activation, so exactly one session.
    expect(
      await RefreshToken.countDocuments({
        orgId: seed.a.orgId,
        userId: (await stored(newMember.email))._id,
      }),
    ).toBe(1);
  });

  it('refuses an expired link, says so, and leaves the account unusable', async () => {
    await invite(newMember);
    const token = lastToken();
    await setExpiry(newMember.email, new Date(Date.now() - 1_000));

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    expect(res.body.error.message).toMatch(/ask your administrator/i);
    expect(res.headers['set-cookie']).toBeUndefined();
    const user = await stored(newMember.email);
    expect(user.inviteTokenHash).toBe(hashToken(token));
    expect(
      (await loginAs(app, { orgSlug: 'org-a', email: newMember.email, password: CHOSEN })).res
        .status,
    ).toBe(401);
  });

  it('accepts a link up to its last moment', async () => {
    await invite(newMember);
    await setExpiry(newMember.email, new Date(Date.now() + 60_000));
    expect((await accept(lastToken())).status).toBe(200);
  });

  it('answers an unknown token with the same refusal as a used one, creating nothing', async () => {
    const before = await User.countDocuments();
    const res = await accept('A'.repeat(43));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVITATION_INVALID');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await User.countDocuments()).toBe(before);
  });

  it('refuses a weak password without using up the link, so the invitee can try again', async () => {
    await invite(newMember);
    const token = lastToken();

    const weak = await accept(token, 'short');
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.some((d) => d.path === 'password')).toBe(true);
    expect(await accept(token, 'a'.repeat(73))).toHaveProperty('status', 400);

    expect((await accept(token, CHOSEN)).status).toBe(200);
  });

  it.each([
    ['no token', { password: CHOSEN }],
    ['a too-short token', { token: 'abc', password: CHOSEN }],
    ['an oversized token', { token: 'a'.repeat(201), password: CHOSEN }],
    ['an operator in place of the token', { token: { $ne: null }, password: CHOSEN }],
    ['no password', { token: 'a'.repeat(43) }],
    ['an unknown field', { token: 'a'.repeat(43), password: CHOSEN, role: 'ORG_ADMIN' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/api/auth/accept-invite').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('needs no session: the token is the credential', async () => {
    await invite(newMember);
    const res = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token: lastToken(), password: CHOSEN });
    expect(res.status).toBe(200);
  });

  it('counts wrong tokens against the auth rate limit, so links cannot be guessed at speed (SR-12)', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await accept(`${'B'.repeat(42)}${i}`)).status);
    }
    // The test environment allows 5 failures per window; the sixth is refused before any lookup.
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});

describe('POST /api/users/:id/resend-invite', () => {
  it('issues a new link and window, and the old link stops working immediately', async () => {
    const first = await invite(newMember);
    const oldToken = lastToken();

    const res = await resend(first.body.user.id);

    expect(res.status).toBe(200);
    expect(res.body.delivery).toBe('email');
    expect(mail).toHaveLength(2);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);
    expect(new Date(res.body.user.invitation.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.user.invitation.expiresAt).getTime(),
    );

    const stale = await accept(oldToken);
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('INVITATION_INVALID');
    expect((await accept(newToken)).status).toBe(200);
  });

  it('revives an expired invitation with a fresh 72 hours', async () => {
    const first = await invite(newMember);
    await setExpiry(newMember.email, new Date(Date.now() - 3_600_000));
    expect((await accept(lastToken())).body.error.code).toBe('INVITATION_EXPIRED');

    const before = Date.now();
    const res = await resend(first.body.user.id);

    expect(res.body.user.invitation.status).toBe('PENDING');
    const window = new Date(res.body.user.invitation.expiresAt).getTime() - before;
    expect(window).toBeGreaterThan(72 * 3_600_000 - 60_000);
    expect((await accept(lastToken())).status).toBe(200);
  });

  it('refuses a member who has already accepted, and sends nothing', async () => {
    const first = await invite(newMember);
    await accept(lastToken());
    mail.length = 0;

    const res = await resend(first.body.user.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(mail).toHaveLength(0);
  });

  it('refuses a member who never had an invitation, such as one of the seeded users', async () => {
    const res = await resend(seed.a.member._id);
    expect(res.status).toBe(409);
    expect(mail).toHaveLength(0);
  });

  it('appends a second USER_INVITED marked as a resend, with the old expiry as before and no token', async () => {
    const first = await invite(newMember);
    await resend(first.body.user.id);

    const events = await AuditEvent.find({
      orgId: seed.a.orgId,
      action: AUDIT_ACTION.USER_INVITED,
    })
      .sort({ _id: 1 })
      .lean();
    expect(events).toHaveLength(2);
    const [, resent] = events;
    expect(String(resent.targetId)).toBe(first.body.user.id);
    expect(new Date(resent.before.inviteExpiresAt).toISOString()).toBe(
      first.body.user.invitation.expiresAt,
    );
    expect(resent.after).toMatchObject({ email: newMember.email, resent: true });
    expect(JSON.stringify(resent)).not.toMatch(/token/i);
  });

  it('leaves the old link working, and sends nothing, when the audit write fails (OD-2)', async () => {
    const first = await invite(newMember);
    const oldToken = lastToken();
    mail.length = 0;
    auditRepo.append.mockRejectedValueOnce(new Error('simulated audit failure'));

    const res = await resend(first.body.user.id);

    expect(res.status).toBe(500);
    expect(mail).toHaveLength(0);
    // The token swap was rolled back with everything else: the original link is still the live one.
    expect((await accept(oldToken)).status).toBe(200);
  });

  it('reports a failed send but keeps the new link, and the old one stays dead', async () => {
    const first = await invite(newMember);
    const oldToken = lastToken();
    setMailTransport({
      sendMail: async () => {
        throw new Error('SMTP connection refused');
      },
    });

    const res = await resend(first.body.user.id);

    expect(res.status).toBe(200);
    expect(res.body.delivery).toBe('failed');
    // Nobody received the new link, and the old one is gone: the admin's next step is to resend again.
    expect((await accept(oldToken)).body.error.code).toBe('INVITATION_INVALID');
    setMailTransport(undefined);
  });

  it('answers 404, not 403, for a user in another organisation (SR-2)', async () => {
    const res = await resend(seed.b.member._id);
    expect(res.status).toBe(404);
    expect(mail).toHaveLength(0);
  });

  it('answers 404 for an id that exists nowhere and 400 for something that is not an id', async () => {
    expect((await resend('0'.repeat(24))).status).toBe(404);
    expect((await resend('not-an-id')).status).toBe(400);
  });

  it.each([
    ['an APPROVER', () => accessCookieFor(seed.a.approver)],
    ['a MEMBER', () => accessCookieFor(seed.a.member)],
  ])('is forbidden to %s (users:manage)', async (_label, cookie) => {
    const first = await invite(newMember);
    mail.length = 0;
    const res = await resend(first.body.user.id, cookie());
    expect(res.status).toBe(403);
    expect(mail).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const first = await invite(newMember);
    const res = await request(app).post(`/api/users/${first.body.user.id}/resend-invite`).send({});
    expect(res.status).toBe(401);
  });

  it('refuses an admin who has been demoted since their token was issued (SDD §6.2)', async () => {
    const first = await invite(newMember);
    await User.updateOne({ _id: seed.a.admin._id }, { $set: { role: ROLES.MEMBER } });
    mail.length = 0;

    const res = await resend(first.body.user.id, accessCookieFor(seed.a.admin));

    expect(res.status).toBe(403);
    expect(mail).toHaveLength(0);
  });

  it('takes no body fields', async () => {
    const first = await invite(newMember);
    const res = await request(app)
      .post(`/api/users/${first.body.user.id}/resend-invite`)
      .set('Cookie', asAdminA())
      .send({ email: 'redirect-the-invite@evil.test' });
    expect(res.status).toBe(400);
  });
});

describe('how invitations show in the member list', () => {
  const invitationOf = async (email) =>
    (await listUsers()).body.items.find((u) => u.email === email).invitation;

  it('reports pending, expired and accepted members differently', async () => {
    await invite({ email: 'pending@a.test', name: 'Pending' });
    await invite({ email: 'expired@a.test', name: 'Expired' });
    await invite({ email: 'done@a.test', name: 'Done' });
    await setExpiry('expired@a.test', new Date(Date.now() - 1_000));
    await accept(tokenIn(mail[2]));

    expect((await invitationOf('pending@a.test')).status).toBe('PENDING');
    expect((await invitationOf('expired@a.test')).status).toBe('EXPIRED');
    expect(await invitationOf('done@a.test')).toBeNull();
    // Members who were never invited have none either.
    expect(await invitationOf(seed.a.member.email)).toBeNull();
  });

  it('never exposes the token hash or the password hash in the list', async () => {
    await invite(newMember);
    const body = JSON.stringify((await listUsers()).body);
    expect(body).not.toMatch(/inviteTokenHash|passwordHash|\$2[aby]\$/);
    expect(body).not.toContain(hashToken(lastToken()));
  });
});

describe('the whole flow, end to end (what SCRUM-58 and SCRUM-45 need to demo)', () => {
  it('an admin invites an approver and a member; both accept by email and have the access their role implies', async () => {
    // The founding admin invites two people.
    const annInvite = await invite({ email: 'ann@a.test', name: 'Ann', role: ROLES.APPROVER });
    const maxInvite = await invite({ email: 'max@a.test', name: 'Max' });
    expect(annInvite.status).toBe(201);
    expect(maxInvite.status).toBe(201);
    expect(mail.map((m) => m.input.to.address)).toEqual(['ann@a.test', 'max@a.test']);

    // Until they open their links they cannot get in at all.
    for (const email of ['ann@a.test', 'max@a.test']) {
      const { res } = await loginAs(app, { orgSlug: 'org-a', email, password: CHOSEN });
      expect(res.status).toBe(401);
    }

    // Each opens their link, chooses a password, and lands signed in.
    const ann = await accept(tokenIn(mail[0]), 'Ann-Chose-This-1');
    const max = await accept(tokenIn(mail[1]), 'Max-Chose-This-1');
    expect(ann.body.user).toMatchObject({ role: ROLES.APPROVER, invitation: null });
    expect(max.body.user).toMatchObject({ role: ROLES.MEMBER, invitation: null });

    // A member can browse the catalogue but cannot manage people or read the audit log.
    const maxCookie = cookieHeaderFrom(max);
    expect((await request(app).get('/api/assets').set('Cookie', maxCookie)).status).toBe(200);
    expect((await request(app).get('/api/users').set('Cookie', maxCookie)).status).toBe(403);
    expect((await request(app).get('/api/audit').set('Cookie', maxCookie)).status).toBe(403);
    // An approver has more than a member but still cannot manage people.
    expect((await request(app).get('/api/users').set('Cookie', cookieHeaderFrom(ann))).status).toBe(
      403,
    );

    // Next week they sign in the ordinary way, with the password they chose.
    const later = await loginAs(app, {
      orgSlug: 'org-a',
      email: 'max@a.test',
      password: 'Max-Chose-This-1',
    });
    expect(later.res.status).toBe(200);

    // The admin sees everyone, all active, and the trail shows who was invited.
    const members = await listUsers();
    expect(members.body.total).toBe(5);
    expect(members.body.items.every((u) => u.invitation === null)).toBe(true);
    const trail = await request(app)
      .get(`/api/audit?action=${AUDIT_ACTION.USER_INVITED}`)
      .set('Cookie', asAdminA());
    expect(trail.body.total).toBe(2);
  });
});

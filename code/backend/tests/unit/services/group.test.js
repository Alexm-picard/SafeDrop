// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: unit tests for isActiveMember(), the eligibility primitive with no HTTP route of its own yet (SCRUM-149)
// Human Contributions: reviewed and approved by Alex Picard (PR #59, 2026-10-03); latest changes reviewed and approved by Mateus Silva (PR #60, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Complements tests/integration/routes/groups.test.js, which covers the HTTP behaviour. Reviewed before merge; see Human Contributions.

/**
 * Unit tests for `isActiveMember()`, the building block a future restricted-equipment feature will
 * call to decide whether someone may request a gated item.
 *
 * There is no HTTP route for this yet — restricted equipment does not exist — so it is exercised by
 * calling the service directly, against a real (in-memory) database rather than mocks: the whole point
 * of the function is a join between two collections (`usergroups` and `users`), and a mock would just
 * be a second, possibly wrong, description of what the real query does.
 */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../src/models/User.js';
import * as groupService from '../../../src/services/group.service.js';
import { seedTwoOrgs } from '../../helpers/seedTwoOrgs.js';

let seed;
beforeEach(async () => {
  seed = await seedTwoOrgs();
});

describe('isActiveMember()', () => {
  it('is true for an active member of the group', async () => {
    const created = await groupService.createGroup(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      {
        name: 'Certified Drone Pilots',
      },
    );
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      created.group.id,
      String(seed.a.member._id),
    );

    expect(
      await groupService.isActiveMember(seed.a.orgId, created.group.id, String(seed.a.member._id)),
    ).toBe(true);
  });

  it('is false for a deactivated member, even though they are still listed in the group', async () => {
    const created = await groupService.createGroup(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      created.group.id,
      String(seed.a.member._id),
    );
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );

    expect(
      await groupService.isActiveMember(seed.a.orgId, created.group.id, String(seed.a.member._id)),
    ).toBe(false);
    // They are still a listed member — deactivation does not remove them from the group (the ticket's
    // second open question: ignore at eligibility checks, do not mutate membership).
    const { group } = await groupService.getGroup(seed.a.orgId, created.group.id);
    expect(group.memberIds).toContain(String(seed.a.member._id));
  });

  it('is false for an active user who simply is not in the group', async () => {
    const created = await groupService.createGroup(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );

    expect(
      await groupService.isActiveMember(seed.a.orgId, created.group.id, String(seed.a.member._id)),
    ).toBe(false);
  });

  it('is false for a group that does not exist', async () => {
    expect(
      await groupService.isActiveMember(
        seed.a.orgId,
        new mongoose.Types.ObjectId().toString(),
        String(seed.a.member._id),
      ),
    ).toBe(false);
  });

  it('is false for a user that does not exist', async () => {
    const created = await groupService.createGroup(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    expect(
      await groupService.isActiveMember(
        seed.a.orgId,
        created.group.id,
        new mongoose.Types.ObjectId().toString(),
      ),
    ).toBe(false);
  });

  it('is false for a member of the right group in the wrong organisation', async () => {
    // Same group name, same member shape, different tenant: isActiveMember must not cross the
    // boundary even though both ids individually look valid.
    const createdA = await groupService.createGroup(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      { name: 'Certified Drone Pilots' },
    );
    await groupService.addGroupMember(
      seed.a.orgId,
      { userId: seed.a.admin._id, role: 'ORG_ADMIN' },
      createdA.group.id,
      String(seed.a.member._id),
    );

    expect(
      await groupService.isActiveMember(seed.b.orgId, createdA.group.id, String(seed.a.member._id)),
    ).toBe(false);
  });
});

/**
 * `isEligible()` (SCRUM-150, SCRUM-173): may this user request this asset, given its
 * `allowedGroupIds`? Being an active member of any one listed group is enough, so an asset can accept
 * both a narrow certification ("Forklift Certified") and a broad one ("Heavy Machinery Certified").
 */
describe('isEligible()', () => {
  const admin = () => ({ userId: seed.a.admin._id, role: 'ORG_ADMIN' });
  const newGroup = async (name) =>
    (await groupService.createGroup(seed.a.orgId, admin(), { name })).group;
  const addMember = (group, user) =>
    groupService.addGroupMember(seed.a.orgId, admin(), group.id, String(user._id));

  it('is true for anyone when the asset lists no groups — unrestricted, the default', async () => {
    expect(
      await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {
        allowedGroupIds: [],
      }),
    ).toBe(true);
  });

  it('is true for an asset with no allowedGroupIds field at all (written before the field existed)', async () => {
    expect(await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {})).toBe(true);
  });

  it('is true for an active member of any one of the listed groups', async () => {
    const forklift = await newGroup('Forklift Certified');
    const heavy = await newGroup('Heavy Machinery Certified');
    await addMember(heavy, seed.a.member);

    expect(
      await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {
        allowedGroupIds: [forklift.id, heavy.id],
      }),
    ).toBe(true);
  });

  it('is false for a user in none of the listed groups, even if they are in another group', async () => {
    const forklift = await newGroup('Forklift Certified');
    const other = await newGroup('Film Dept Staff');
    await addMember(other, seed.a.member);

    expect(
      await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {
        allowedGroupIds: [forklift.id],
      }),
    ).toBe(false);
  });

  it('is false for a deactivated member who is still listed in an allowed group', async () => {
    const forklift = await newGroup('Forklift Certified');
    await addMember(forklift, seed.a.member);
    await User.collection.updateOne(
      { _id: seed.a.member._id },
      { $set: { deactivatedAt: new Date() } },
    );

    expect(
      await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {
        allowedGroupIds: [forklift.id],
      }),
    ).toBe(false);
  });

  it('is false when every listed group has since been deleted — fails closed, never open', async () => {
    expect(
      await groupService.isEligible(seed.a.orgId, String(seed.a.member._id), {
        allowedGroupIds: [new mongoose.Types.ObjectId().toString()],
      }),
    ).toBe(false);
  });

  it('does not count membership of a group in another organisation', async () => {
    const forklift = await newGroup('Forklift Certified');
    await addMember(forklift, seed.a.member);

    expect(
      await groupService.isEligible(seed.b.orgId, String(seed.a.member._id), {
        allowedGroupIds: [forklift.id],
      }),
    ).toBe(false);
  });
});

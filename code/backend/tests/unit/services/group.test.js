// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~100% (written by Claude Code from the user-groups ticket)
// AI-Assisted Areas: unit tests for isActiveMember(), the eligibility primitive with no HTTP route of its own yet (SCRUM-149)
// Human Contributions: pending review
// Notes: Complements tests/integration/routes/groups.test.js, which covers the HTTP behaviour. Must be reviewed by the owning team member before merge.

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

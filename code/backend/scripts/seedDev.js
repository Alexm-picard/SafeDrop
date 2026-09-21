/* eslint-disable no-console */

// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90%
// AI-Assisted Areas: `npm run seed` CLI wrapper — connects, wipes/reseeds org-a and org-b, prints credentials
// Human Contributions: reviewed by Mateus Silva (PR #12, 2026-09-19)

/**
 * `npm run seed`: wipes and reseeds the two demo organizations (see seedTwoOrgs), then prints
 * everyone's login and every id created. Destructive on every run by design; refuses on
 * NODE_ENV=production. Needs only MONGODB_URI — does not load the app's full env config.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { AssetUnit } from '../src/models/AssetUnit.js';
import { Asset } from '../src/models/Asset.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { CheckoutRequest } from '../src/models/CheckoutRequest.js';
import { Organization } from '../src/models/Organization.js';
import { User } from '../src/models/User.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { seedAssetHistory, seedTwoOrgs, TEST_PASSWORD } from '../tests/helpers/seedTwoOrgs.js';

dotenv.config({ path: ['.env', '../../.env'] });

const SLUGS = ['org-a', 'org-b'];

async function wipeOrg(slug) {
  const org = await Organization.findOne({ slug });
  if (!org) {
    return;
  }
  const orgId = org._id;
  await Promise.all([
    CheckoutRequest.deleteMany({ orgId }),
    AssetUnit.deleteMany({ orgId }),
    Asset.deleteMany({ orgId }),
    User.deleteMany({ orgId }),
    AuditEvent.collection.deleteMany({ orgId }),
  ]);
  await Organization.deleteOne({ _id: orgId });
}

function printOrgSummary(key, org) {
  console.log(
    `\nOrg ${key.toUpperCase()} — ${org.org.name} (slug: ${org.org.slug}, id: ${org.orgId})`,
  );

  console.log('  Users:');
  const roleUsers = { admin: org.admin, approver: org.approver, member: org.member };
  for (const [role, user] of Object.entries(roleUsers)) {
    console.log(`    ${role.padEnd(9)} ${user.email}  (id: ${user._id})`);
  }

  console.log('  Assets:');
  const allAssets = [{ asset: org.asset, units: org.units }, ...org.extraAssets];
  for (const { asset, units } of allAssets) {
    console.log(`    ${asset.name} [${asset.category}]  (id: ${asset._id})`);
    for (const unit of units) {
      console.log(`      unit ${unit.tag} — ${unit.status}  (id: ${unit._id})`);
    }
  }

  console.log('  Requests:');
  const requests = [
    org.request,
    org.heldRequest,
    org.checkedOutRequest,
    org.projectorRequest,
    org.lostRequest,
  ];
  for (const req of requests) {
    console.log(
      `    ${req.state}  unit=${req.unitId}  requester=${req.requesterId}  (id: ${req._id})`,
    );
  }

  console.log('  Audit events:');
  console.log(`    ${org.audit.action}  (id: ${org.audit._id})`);
  // The laptop's chain of custody (SCRUM-39). Printed as a count rather than a list: the point of
  // the demo is that the screen shows them, and nine more lines here would bury the credentials.
  console.log(
    `    + ${org.assetHistory.length} events on ${org.asset.name} — open /assets/${org.asset._id} as the admin to see them`,
  );
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV=production.');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required to run the seed script.');
    process.exit(1);
  }

  await connectDb(process.env.MONGODB_URI);
  try {
    const existing = await Organization.find({ slug: mongoose.trusted({ $in: SLUGS }) });
    if (existing.length > 0) {
      console.log(
        `Existing seed orgs found (${existing.map((o) => o.slug).join(', ')}) — wiping and recreating.`,
      );
      for (const slug of SLUGS) {
        await wipeOrg(slug);
      }
    }

    const seed = await seedTwoOrgs();
    // The fixture leaves one audit event per org; the demo needs an asset with a story on it
    // (SCRUM-39). Done here rather than inside the fixture so the integration tests, which count
    // audit rows, are not coupled to demo data.
    seed.a.assetHistory = await seedAssetHistory(seed.a);
    seed.b.assetHistory = await seedAssetHistory(seed.b);
    console.log(`\nShared password for all seeded users: ${TEST_PASSWORD}`);
    printOrgSummary('a', seed.a);
    printOrgSummary('b', seed.b);
    console.log();
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

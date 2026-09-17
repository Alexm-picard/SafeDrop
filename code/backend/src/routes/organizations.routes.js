// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: POST /api/organizations (public bootstrap, SCRUM-101)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import * as organizations from '../controllers/organizations.controller.js';
import { createRouter, defineRoute } from './define.js';
import { email, orgName, password, personName } from './schemas.js';

export const createOrganizationBody = z.object({
  orgName,
  adminName: personName,
  adminEmail: email,
  adminPassword: password,
});

export const organizationsRouter = createRouter();

defineRoute(
  organizationsRouter,
  { method: 'POST', path: '/', public: true, schemas: { body: createOrganizationBody } },
  organizations.create,
);

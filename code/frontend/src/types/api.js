// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: JSDoc typedefs mirroring the backend contracts (SDD §2.4, §6.5) for editor help in plain JavaScript; InviteUserInput
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// Reference these from JSDoc, e.g. `/** @type {import('../types/api').User} */`.
// Converting the SPA to TypeScript (Iteration 3 optional item) turns these into real types.

/**
 * JSDoc typedefs for every shape the API returns.
 *
 * The frontend is plain JavaScript for Iteration 1 (SPPP §3), so these stand in for TypeScript
 * interfaces: editors and `checkJs` read them, and they document the contract between the SPA and the
 * API in one place. Reference them from a JSDoc `@type` annotation, as the header comment above
 * shows.
 *
 * They must match what the backend actually sends — `publicUser()` in services/auth.service.js and the
 * repositories' list shapes. Converting the SPA to TypeScript (the Iteration 3 optional item) turns
 * these into real types with no rewriting.
 *
 * The file exports nothing at runtime; it exists only for its types.
 */

/** @typedef {'MEMBER' | 'APPROVER' | 'ORG_ADMIN'} Role */

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} orgId
 * @property {string} email
 * @property {string} name
 * @property {Role} role
 * @property {string} [createdAt]
 */

/**
 * @typedef {object} InviteUserInput
 * @property {string} email
 * @property {string} name
 * @property {string} password the initial password the admin sets and shares; never returned
 * @property {Role} [role] defaults to MEMBER
 */

/**
 * @typedef {object} Organization
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {string} [createdAt]
 */

/**
 * @typedef {object} DashboardSummary
 * @property {number} totalAssets
 * @property {number} checkedOut
 * @property {number} available
 * @property {number} held
 * @property {number} retired
 */

/** @typedef {'AVAILABLE' | 'HELD' | 'OUT' | 'RETIRED'} UnitStatus */

/** @typedef {'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED' | 'CHECKED_OUT' | 'OVERDUE' | 'RETURNED' | 'LOST'} RequestState */

/**
 * @typedef {object} Asset
 * @property {string} id
 * @property {string} orgId
 * @property {string} name
 * @property {string} category
 * @property {string} description
 * @property {string | null} imageUrl
 * @property {string | null} retiredAt
 */

/**
 * @typedef {object} AssetUnit
 * @property {string} id
 * @property {string} orgId
 * @property {string} assetId
 * @property {string} tag
 * @property {string | null} serial
 * @property {'NEW' | 'GOOD' | 'FAIR' | 'POOR'} condition
 * @property {UnitStatus} status
 */

/**
 * @typedef {object} CheckoutRequest
 * @property {string} id
 * @property {string} orgId
 * @property {string} unitId
 * @property {string} requesterId
 * @property {RequestState} state
 * @property {string} neededFrom
 * @property {string} neededTo
 * @property {string} note
 * @property {string | null} decidedBy
 * @property {string | null} decidedAt
 * @property {string | null} checkedOutAt
 * @property {string | null} dueAt
 * @property {string | null} returnedAt
 */

/**
 * @typedef {object} AuditEvent
 * @property {string} id
 * @property {string} orgId
 * @property {string} actorId
 * @property {Role} actorRole
 * @property {string} action
 * @property {string} targetType
 * @property {string} targetId
 * @property {unknown} before
 * @property {unknown} after
 * @property {string} timestamp
 * @property {string | null} requestId
 */

/**
 * @template T
 * @typedef {object} Paginated
 * @property {T[]} items
 * @property {number} total
 * @property {number} page
 * @property {number} limit
 */

/**
 * @typedef {object} ApiErrorDetail
 * @property {'params' | 'query' | 'body'} location
 * @property {string} path
 * @property {string} message
 */

/**
 * Every non-2xx response has this shape (SDD §6.5).
 * @typedef {object} ApiErrorBody
 * @property {{ code: string, message: string, details?: ApiErrorDetail[] | Record<string, unknown>, requestId?: string }} error
 */

/**
 * @typedef {object} LoginCredentials
 * @property {string} orgSlug
 * @property {string} email
 * @property {string} password
 */

/**
 * @typedef {object} CreateOrganizationInput
 * @property {string} orgName
 * @property {string} adminName
 * @property {string} adminEmail
 * @property {string} adminPassword
 */

export {};

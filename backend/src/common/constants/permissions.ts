/**
 * SIMPROK Permission Catalog
 *
 * Canonical declarative source for permission codes.
 *
 * IMPORTANT:
 * - This file does not seed the database.
 * - This file does not change runtime behavior.
 * - Seed normalization is a separate slice.
 * - Permission codes must be added here before being used by seeds,
 *   guards, controllers, or decorators in future slices.
 */

export const PERMISSIONS = {
  WORKSPACE_MEMBERSHIP_VIEW: 'WORKSPACE_MEMBERSHIP_VIEW',
  WORKSPACE_MEMBERSHIP_MANAGE: 'WORKSPACE_MEMBERSHIP_MANAGE',

  AUTHORITY_VIEW: 'AUTHORITY_VIEW',
  AUTHORITY_MANAGE: 'AUTHORITY_MANAGE',
  AUTHORITY_ASSIGN: 'AUTHORITY_ASSIGN',

  APPROVAL_MATRIX_VIEW: 'APPROVAL_MATRIX_VIEW',
  APPROVAL_MATRIX_MANAGE: 'APPROVAL_MATRIX_MANAGE',

  FIELD_PROGRESS_SUBMIT: 'FIELD_PROGRESS_SUBMIT',
  FIELD_PROGRESS_CORRECT: 'FIELD_PROGRESS_CORRECT',
  FIELD_PROGRESS_VERIFY: 'FIELD_PROGRESS_VERIFY',
  FIELD_PROGRESS_ACCEPT: 'FIELD_PROGRESS_ACCEPT',

  PROJECT_VIEW: 'PROJECT_VIEW',
  PROJECT_CREATE: 'PROJECT_CREATE',
  PROJECT_SETTINGS_MANAGE: 'PROJECT_SETTINGS_MANAGE',
  RAB_VIEW: 'RAB_VIEW',
  RAB_DRAFT_EDIT: 'RAB_DRAFT_EDIT',

  OBSERVATORY_VIEW: 'OBSERVATORY_VIEW',

  // Golden Path v0 — AHSP domain
  AHSP_VIEW: 'AHSP_VIEW',
  AHSP_MANAGE: 'AHSP_MANAGE',
  AHSP_APPROVE: 'AHSP_APPROVE',

  // Golden Path v0 — Basic Price domain
  BASIC_PRICE_VIEW: 'BASIC_PRICE_VIEW',
  BASIC_PRICE_MANAGE: 'BASIC_PRICE_MANAGE',

  // RM-02 — Basic Price import foundation. Declared and enforced by
  // guards/controllers. Activation (Permission/RolePermission/RoleAssignment
  // rows) is governed per environment and is NOT tracked here — see
  // GOVERNED_ACTIVATION_PERMISSION_CODES below. This source file is a
  // declarative catalog, not a live snapshot of any environment's DB: it
  // must never be read as "seeded" or "not seeded" in a specific database.
  // A route gated by one of these codes fail-closes (403) in any
  // environment where the permission has not been granted to the caller's
  // role, exactly like any other permission code.
  BASIC_PRICE_IMPORT: 'BASIC_PRICE_IMPORT',
  BASIC_PRICE_RESOLVE: 'BASIC_PRICE_RESOLVE',
  BASIC_PRICE_SUBMIT: 'BASIC_PRICE_SUBMIT',
  BASIC_PRICE_VERIFY: 'BASIC_PRICE_VERIFY',
  BASIC_PRICE_PUBLISH: 'BASIC_PRICE_PUBLISH',
  BASIC_PRICE_REVIEW_VIEW: 'BASIC_PRICE_REVIEW_VIEW',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Catalog states describe how a permission code is declared in THIS
// source file — never a live snapshot of any environment's database.
// SEEDED_CURRENT = shipped with a canonical production/acceptance seed
// task that runs in every environment by default. GOVERNED_ACTIVATION =
// enforced by guards/controllers, but granting it to any role in any
// specific environment is a separate, governed activation decision (e.g.
// RM02C3 acceptance activation) — this file does not assert whether that
// activation has happened anywhere. ACTIVE_MEMBERSHIP_BASELINE = granted
// structurally, by WorkspacePermissionResolverService itself, to every
// ACTIVE WorkspaceMembership regardless of role/custom-role/no-role —
// never dependent on a RolePermission seed row or a per-environment
// activation decision (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT
// MODEL). This precedent is scoped to exactly the codes listed in
// ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES below and must not be
// extended to any other permission without a new Owner decision.
export const PERMISSION_CATALOG_STATES = {
  SEEDED_CURRENT: 'SEEDED_CURRENT',
  GOVERNED_ACTIVATION: 'GOVERNED_ACTIVATION',
  ACTIVE_MEMBERSHIP_BASELINE: 'ACTIVE_MEMBERSHIP_BASELINE',
} as const;

export type PermissionCatalogState =
  (typeof PERMISSION_CATALOG_STATES)[keyof typeof PERMISSION_CATALOG_STATES];

export const PERMISSION_DOMAINS = {
  WORKSPACE_MEMBERSHIP: 'WORKSPACE_MEMBERSHIP',
  AUTHORITY: 'AUTHORITY',
  APPROVAL_MATRIX: 'APPROVAL_MATRIX',
  FIELD_PROGRESS: 'FIELD_PROGRESS',
  PROJECT: 'PROJECT',
  OBSERVATORY: 'OBSERVATORY',
  AHSP: 'AHSP',
  BASIC_PRICE: 'BASIC_PRICE',
} as const;

export type PermissionDomain =
  (typeof PERMISSION_DOMAINS)[keyof typeof PERMISSION_DOMAINS];

export interface PermissionCatalogEntry {
  code: PermissionCode;
  domain: PermissionDomain;
  state: PermissionCatalogState;
  description: string;
  note?: string;
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  {
    code: PERMISSIONS.WORKSPACE_MEMBERSHIP_VIEW,
    domain: PERMISSION_DOMAINS.WORKSPACE_MEMBERSHIP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'View workspace membership records within an authorized workspace.',
  },
  {
    code: PERMISSIONS.WORKSPACE_MEMBERSHIP_MANAGE,
    domain: PERMISSION_DOMAINS.WORKSPACE_MEMBERSHIP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Manage workspace membership records within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AUTHORITY_VIEW,
    domain: PERMISSION_DOMAINS.AUTHORITY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'View authority positions and structure within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AUTHORITY_MANAGE,
    domain: PERMISSION_DOMAINS.AUTHORITY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Manage authority positions and structure within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AUTHORITY_ASSIGN,
    domain: PERMISSION_DOMAINS.AUTHORITY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Assign users and authorities within an authorized workspace.',
  },
  {
    code: PERMISSIONS.APPROVAL_MATRIX_VIEW,
    domain: PERMISSION_DOMAINS.APPROVAL_MATRIX,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'View approval matrix rules within an authorized workspace.',
  },
  {
    code: PERMISSIONS.APPROVAL_MATRIX_MANAGE,
    domain: PERMISSION_DOMAINS.APPROVAL_MATRIX,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Manage approval matrix rules within an authorized workspace.',
  },
  {
    code: PERMISSIONS.FIELD_PROGRESS_SUBMIT,
    domain: PERMISSION_DOMAINS.FIELD_PROGRESS,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Submit field progress entries for an assigned project.',
  },
  {
    code: PERMISSIONS.FIELD_PROGRESS_CORRECT,
    domain: PERMISSION_DOMAINS.FIELD_PROGRESS,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'Invoke correction of a field progress Actual within an assigned project; decision authority remains separately governed by PositionAuthority.',
    note: 'MON-03 Owner clarification: technical capability is not job-title authority and is never PROJECT_VIEW.',
  },
  {
    code: PERMISSIONS.FIELD_PROGRESS_VERIFY,
    domain: PERMISSION_DOMAINS.FIELD_PROGRESS,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'Invoke verification of a field progress Actual within an assigned project; decision authority remains separately governed by PositionAuthority.',
    note: 'MON-03 Owner clarification: technical capability is not job-title authority and is never PROJECT_VIEW.',
  },
  {
    code: PERMISSIONS.FIELD_PROGRESS_ACCEPT,
    domain: PERMISSION_DOMAINS.FIELD_PROGRESS,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'Invoke acceptance of a field progress Actual within an assigned project; decision authority remains separately governed by PositionAuthority.',
    note: 'MON-03 Owner clarification: technical capability is not job-title authority and is never PROJECT_VIEW.',
  },
  {
    code: PERMISSIONS.PROJECT_VIEW,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'View authorized project records and project-scoped data.',
  },
  {
    code: PERMISSIONS.PROJECT_CREATE,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Create or initiate project records where authorized.',
    note: 'Seeded through RBAC seed in IDENTITY-A2. Runtime DB requires normal seed/test setup to materialize this permission.',
  },
  {
    code: PERMISSIONS.PROJECT_SETTINGS_MANAGE,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'Configure Project-owned settings on an assigned project through governed activation.',
    note: 'MON-03: Project timezone changes use this precise capability; PROJECT_CREATE and PROJECT_VIEW are not edit shortcuts.',
  },
  {
    code: PERMISSIONS.RAB_VIEW,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'View RAB drafts and import previews for an authorized project.',
  },
  {
    code: PERMISSIONS.RAB_DRAFT_EDIT,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Edit an authorized project RAB draft, including approved BOQ import.',
  },
  {
    code: PERMISSIONS.OBSERVATORY_VIEW,
    domain: PERMISSION_DOMAINS.OBSERVATORY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'View workspace-scoped Observatory or portfolio intelligence data.',
    note: 'Seeded through RBAC seed in DEBT-04-A1. Endpoint enforcement is a separate DEBT-04 slice.',
  },
  // ── Golden Path v0 — AHSP Domain ──────────────────────────────────────────
  {
    code: PERMISSIONS.AHSP_VIEW,
    domain: PERMISSION_DOMAINS.AHSP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'View AHSP records and versions within an authorized workspace.',
    note: 'Seeded in Golden Path v0 Slice B.',
  },
  {
    code: PERMISSIONS.AHSP_MANAGE,
    domain: PERMISSION_DOMAINS.AHSP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Create, update, archive, delete AHSP records and versions within an authorized workspace.',
    note: 'Seeded in Golden Path v0 Slice B.',
  },
  {
    code: PERMISSIONS.AHSP_APPROVE,
    domain: PERMISSION_DOMAINS.AHSP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Approve AHSP records and promote them to workspace or official status.',
    note: 'Seeded in Golden Path v0 Slice B.',
  },
  // ── Golden Path v0 — Basic Price Domain ───────────────────────────────────
  {
    code: PERMISSIONS.BASIC_PRICE_VIEW,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.ACTIVE_MEMBERSHIP_BASELINE,
    description:
      'View basic price records scoped to workspace or global catalog.',
    note: 'ONE SIMPROK BASIC PRICE PRODUCT MODEL: granted structurally by WorkspacePermissionResolverService to every ACTIVE WorkspaceMembership, any role/custom-role/no-role, independent of RolePermission seeding. Also present in SEEDED_PERMISSION_CODES from Golden Path v0 Slice B — both facts hold simultaneously.',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_MANAGE,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description:
      'Submit and manage basic price records within an authorized workspace.',
    note: 'Seeded in Golden Path v0 Slice B.',
  },
  // ── RM-02 — Basic Price Import Foundation ─────────────────────────────────
  // BASIC_PRICE_IMPORT / _RESOLVE / _SUBMIT are the USER-OWNED IMPORT
  // BOUNDARY (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT MODEL): a
  // user's own import-batch lifecycle (upload, view own batch, resolve/
  // reject own rows, submit own batch to curation) is a baseline product
  // capability, never a governed-per-role activation. They are no longer
  // described as living only through governed role activation — see
  // ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES below.
  {
    code: PERMISSIONS.BASIC_PRICE_IMPORT,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.ACTIVE_MEMBERSHIP_BASELINE,
    description:
      "Upload a Basic Price workbook and create/preview/view/update the caller's own BasicPriceImportBatch.",
    note: 'Granted structurally to every ACTIVE WorkspaceMembership by WorkspacePermissionResolverService — not dependent on RolePermission seeding or per-environment activation. Batch access is further scoped to the uploading account (see basic-price-import-ownership.util.ts).',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_RESOLVE,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.ACTIVE_MEMBERSHIP_BASELINE,
    description:
      "Resolve or reject a row in the caller's own imported Basic Price batch (resource/unit assignment, collision disposition).",
    note: "Granted structurally to every ACTIVE WorkspaceMembership. Resolving is scoped to batches the caller uploaded — this is not a curation/verification authority over other users' submissions.",
  },
  {
    code: PERMISSIONS.BASIC_PRICE_SUBMIT,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.ACTIVE_MEMBERSHIP_BASELINE,
    description:
      "Materialize the caller's own resolved Basic Price import rows: submit them to SIMPROK curation as PriceSubmission rows, and/or keep them as workspace-private Basic Prices for the caller's own workspace.",
    note: "Granted structurally to every ACTIVE WorkspaceMembership. RM-03C added the keep-private action under this SAME code rather than minting a new one: it is the identical authority (materialize my own resolved rows) held by the identical people, and it is strictly the LESS powerful of the two — a private price produces nothing outside the caller's own workspace, while submission hands the batch to the separate internal curation queue. Neither action grants any curation authority itself, and no new ACTIVE_MEMBERSHIP_BASELINE code was introduced (that would require a new Owner decision — see Amendment A1, docs/control/DECISIONS.md).",
  },
  {
    code: PERMISSIONS.BASIC_PRICE_VERIFY,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'Accept, reject, request correction, or reassign a submitted Basic Price review.',
    note: 'Internal curation authority — NEVER part of the ACTIVE_MEMBERSHIP_BASELINE. RM-02D2A-1: guard-enforced on /basic-price-reviews/*. Activation into any role remains a separate, governed decision per environment.',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_PUBLISH,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description: 'Publish a verified BasicPrice, making it publicly eligible.',
    note: 'Internal curation authority — NEVER part of the ACTIVE_MEMBERSHIP_BASELINE. RM-02D2A-1: guard-enforced on /basic-price-publications/*. Activation into any role remains a separate, governed decision per environment. Owner Lock requires the publisher role to differ from the verifier role in practice.',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
    domain: PERMISSION_DOMAINS.BASIC_PRICE,
    state: PERMISSION_CATALOG_STATES.GOVERNED_ACTIVATION,
    description:
      'View internal (pre-publication) Basic Price submissions and curation reviews.',
    note: "Internal curation authority — NEVER part of the ACTIVE_MEMBERSHIP_BASELINE, and no longer used to gate a user's own import batch (see basic-price-import.controller.ts, which uses BASIC_PRICE_IMPORT/_RESOLVE for that instead). RM-02C3 activated this code for the acceptance environment only — see rm02c3-basic-price-acceptance-activation.ts. Not part of any canonical production seed.",
  },
] as const;

export const SEEDED_PERMISSION_CODES: readonly PermissionCode[] = [
  PERMISSIONS.WORKSPACE_MEMBERSHIP_VIEW,
  PERMISSIONS.WORKSPACE_MEMBERSHIP_MANAGE,
  PERMISSIONS.AUTHORITY_VIEW,
  PERMISSIONS.AUTHORITY_MANAGE,
  PERMISSIONS.AUTHORITY_ASSIGN,
  PERMISSIONS.APPROVAL_MATRIX_VIEW,
  PERMISSIONS.APPROVAL_MATRIX_MANAGE,
  PERMISSIONS.FIELD_PROGRESS_SUBMIT,
  PERMISSIONS.PROJECT_VIEW,
  PERMISSIONS.PROJECT_CREATE,
  PERMISSIONS.RAB_VIEW,
  PERMISSIONS.RAB_DRAFT_EDIT,
  PERMISSIONS.OBSERVATORY_VIEW,
  PERMISSIONS.AHSP_VIEW,
  PERMISSIONS.AHSP_MANAGE,
  PERMISSIONS.AHSP_APPROVE,
  PERMISSIONS.BASIC_PRICE_VIEW,
  PERMISSIONS.BASIC_PRICE_MANAGE,
];

// Guard-enforced permission codes whose activation (granting to a role in
// a specific environment) is a separate, governed decision — NOT a claim
// that any particular environment's DB currently lacks them. Some of these
// codes ARE already active in the acceptance environment via RM02C3 (see
// rm02c3-basic-price-acceptance-activation.ts); this list does not track
// that. Treat this as "requires governed activation before use," never as
// "not seeded anywhere." These are internal curation authorities and are
// NEVER part of ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES below.
export const GOVERNED_ACTIVATION_PERMISSION_CODES: readonly PermissionCode[] = [
  PERMISSIONS.FIELD_PROGRESS_CORRECT,
  PERMISSIONS.FIELD_PROGRESS_VERIFY,
  PERMISSIONS.FIELD_PROGRESS_ACCEPT,
  PERMISSIONS.PROJECT_SETTINGS_MANAGE,
  PERMISSIONS.BASIC_PRICE_VERIFY,
  PERMISSIONS.BASIC_PRICE_PUBLISH,
  PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
];

// Permission codes granted structurally, by WorkspacePermissionResolverService
// itself, to every ACTIVE WorkspaceMembership — regardless of role,
// custom role, or missing role, and independent of any RolePermission seed
// row (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT MODEL). This is the
// "One SIMPROK" baseline: SIMPROK has no role-based product variant for
// Basic Price. Scoped to exactly these four codes — extending this
// precedent to any other permission requires a new Owner decision (see
// Amendment A1, docs/control/DECISIONS.md).
export const ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES: readonly PermissionCode[] =
  [
    PERMISSIONS.BASIC_PRICE_VIEW,
    PERMISSIONS.BASIC_PRICE_IMPORT,
    PERMISSIONS.BASIC_PRICE_RESOLVE,
    PERMISSIONS.BASIC_PRICE_SUBMIT,
  ];

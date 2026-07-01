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

  PROJECT_VIEW: 'PROJECT_VIEW',
  PROJECT_CREATE: 'PROJECT_CREATE',

  OBSERVATORY_VIEW: 'OBSERVATORY_VIEW',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG_STATES = {
  SEEDED_CURRENT: 'SEEDED_CURRENT',
  USED_NOT_SEEDED: 'USED_NOT_SEEDED',
  NEEDED_NOT_SEEDED: 'NEEDED_NOT_SEEDED',
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
    description: 'View workspace membership records within an authorized workspace.',
  },
  {
    code: PERMISSIONS.WORKSPACE_MEMBERSHIP_MANAGE,
    domain: PERMISSION_DOMAINS.WORKSPACE_MEMBERSHIP,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Manage workspace membership records within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AUTHORITY_VIEW,
    domain: PERMISSION_DOMAINS.AUTHORITY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'View authority positions and structure within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AUTHORITY_MANAGE,
    domain: PERMISSION_DOMAINS.AUTHORITY,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'Manage authority positions and structure within an authorized workspace.',
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
    code: PERMISSIONS.PROJECT_VIEW,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.SEEDED_CURRENT,
    description: 'View authorized project records and project-scoped data.',
  },
  {
    code: PERMISSIONS.PROJECT_CREATE,
    domain: PERMISSION_DOMAINS.PROJECT,
    state: PERMISSION_CATALOG_STATES.USED_NOT_SEEDED,
    description: 'Create or initiate project records where authorized.',
    note: 'Known ghost permission from IDENTITY-A0: used by controllers but not seeded yet. Do not seed in A1.',
  },
  {
    code: PERMISSIONS.OBSERVATORY_VIEW,
    domain: PERMISSION_DOMAINS.OBSERVATORY,
    state: PERMISSION_CATALOG_STATES.NEEDED_NOT_SEEDED,
    description: 'View workspace-scoped Observatory or portfolio intelligence data.',
    note: 'Declared for future DEBT-04 Observatory Backend RBAC. Do not seed or enforce in A1.',
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
];

export const DECLARED_NOT_SEEDED_PERMISSION_CODES: readonly PermissionCode[] = [
  PERMISSIONS.PROJECT_CREATE,
  PERMISSIONS.OBSERVATORY_VIEW,
];

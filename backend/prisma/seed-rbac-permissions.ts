import { PrismaClient, Prisma } from '@prisma/client';
import { PERMISSIONS } from '../src/common/constants/permissions';

const EXPECTED_DATABASE = 'simprok_db';

export type RbacTransactionClient = Prisma.TransactionClient;

export interface CanonicalPermissionDefinition {
  code: string;
  name: string;
  description: string;
}

export const CANONICAL_PERMISSIONS: readonly CanonicalPermissionDefinition[] = [
  {
    code: 'WORKSPACE_MEMBERSHIP_VIEW',
    name: 'View Workspace Memberships',
    description: 'View workspace membership records within an authorized workspace.',
  },
  {
    code: 'WORKSPACE_MEMBERSHIP_MANAGE',
    name: 'Manage Workspace Memberships',
    description: 'Manage workspace membership records within an authorized workspace.',
  },
  {
    code: 'AUTHORITY_VIEW',
    name: 'View Authority Structure',
    description: 'View authority positions and structure within an authorized workspace.',
  },
  {
    code: 'AUTHORITY_MANAGE',
    name: 'Manage Authority Structure',
    description: 'Manage authority positions and structure within an authorized workspace.',
  },
  {
    code: 'AUTHORITY_ASSIGN',
    name: 'Assign Authority Structure',
    description: 'Assign users and authorities within an authorized workspace.',
  },
  {
    code: 'APPROVAL_MATRIX_VIEW',
    name: 'View Approval Matrices',
    description: 'View approval matrix rules within an authorized workspace.',
  },
  {
    code: 'APPROVAL_MATRIX_MANAGE',
    name: 'Manage Approval Matrices',
    description: 'Manage approval matrix rules within an authorized workspace.',
  },
  {
    code: 'FIELD_PROGRESS_SUBMIT',
    name: 'Submit Field Progress',
    description: 'Allows an assigned field actor (e.g. Foreman) to submit field progress entries for an assigned project. This is a WRITE/SUBMIT permission and must not be granted to VIEW-only roles.',
  },
  {
    code: PERMISSIONS.PROJECT_VIEW,
    name: 'View Projects',
    description: 'View authorized project records and project-scoped data.',
  },
  { code: PERMISSIONS.PROJECT_CREATE, name: 'Create Projects', description: 'Create or initiate project records where authorized.' },
  { code: PERMISSIONS.RAB_VIEW, name: 'View RAB', description: 'View RAB drafts and bounded import previews.' },
  { code: PERMISSIONS.RAB_DRAFT_EDIT, name: 'Edit RAB Draft', description: 'Edit RAB drafts and approve bounded BOQ imports.' },
  {
    code: PERMISSIONS.OBSERVATORY_VIEW,
    name: 'View Observatory',
    description: 'View workspace-scoped Observatory or portfolio intelligence data.',
  },
  {
    code: PERMISSIONS.AHSP_VIEW,
    name: 'View AHSP',
    description: 'View AHSP records and versions within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AHSP_MANAGE,
    name: 'Manage AHSP',
    description: 'Create, update, archive, delete AHSP records and versions within an authorized workspace.',
  },
  {
    code: PERMISSIONS.AHSP_APPROVE,
    name: 'Approve AHSP',
    description: 'Approve AHSP records and promote them to workspace or official status.',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_VIEW,
    name: 'View Basic Price',
    description: 'View basic price records scoped to workspace or global catalog.',
  },
  {
    code: PERMISSIONS.BASIC_PRICE_MANAGE,
    name: 'Manage Basic Price',
    description: 'Submit and manage basic price records within an authorized workspace.',
  },
];

export const DIRECTOR_ALLOWED_PERMISSION_CODES: readonly string[] = [
  'WORKSPACE_MEMBERSHIP_VIEW',
  'AUTHORITY_VIEW',
  'APPROVAL_MATRIX_VIEW',
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

export const DIRECTOR_FORBIDDEN_PERMISSION_CODES: readonly string[] = [
  'WORKSPACE_MEMBERSHIP_MANAGE',
  'AUTHORITY_MANAGE',
  'AUTHORITY_ASSIGN',
  'APPROVAL_MATRIX_MANAGE',
  'FIELD_PROGRESS_SUBMIT', // DIRECTOR is view-only; must never submit field progress
];

/**
 * Idempotently ensures every canonical permission row exists, returning a
 * code -> id map. Safe to call inside any transaction, including one that
 * also creates the role(s) that will receive these permissions.
 */
export async function ensureCanonicalPermissions(
  tx: RbacTransactionClient,
): Promise<Map<string, string>> {
  const ensuredPermissions = new Map<string, string>();

  for (const permission of CANONICAL_PERMISSIONS) {
    const ensured = await tx.permission.upsert({
      where: { code: permission.code },
      update: {
        name: permission.name,
        description: permission.description,
      },
      create: permission,
    });

    ensuredPermissions.set(ensured.code, ensured.id);
  }

  return ensuredPermissions;
}

/**
 * Grants exactly the given permission codes to the given role, upserting
 * RolePermission rows. Throws if a requested code was not ensured first.
 */
export async function grantPermissionsToRole(
  tx: RbacTransactionClient,
  roleId: string,
  permissionIds: Map<string, string>,
  codes: readonly string[],
): Promise<void> {
  for (const code of codes) {
    const permissionId = permissionIds.get(code);
    if (!permissionId) {
      throw new Error(`STOP: permission ${code} was not ensured.`);
    }

    await tx.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId },
      },
      update: {},
      create: { roleId, permissionId },
    });
  }
}

/**
 * Throws if the given role already has any of the forbidden permission
 * codes mapped. Used both as a pre-check (existing roles) and a post-check
 * (immediately after granting, as a same-transaction proof).
 */
export async function assertNoForbiddenPermissions(
  tx: RbacTransactionClient,
  roleId: string,
  permissionIds: Map<string, string>,
  forbiddenCodes: readonly string[],
): Promise<void> {
  const forbiddenPermissionIds = forbiddenCodes
    .map((code) => permissionIds.get(code))
    .filter((id): id is string => Boolean(id));

  if (forbiddenPermissionIds.length === 0) {
    return;
  }

  const forbiddenMappings = await tx.rolePermission.findMany({
    where: {
      roleId,
      permissionId: { in: forbiddenPermissionIds },
    },
    select: { roleId: true, permissionId: true },
  });

  if (forbiddenMappings.length > 0) {
    throw new Error(
      `STOP: role ${roleId} has a forbidden MANAGE/ASSIGN permission mapping.`,
    );
  }
}

async function assertDatabaseGuard(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const actualDatabase = rows[0]?.current_database;

  if (actualDatabase !== EXPECTED_DATABASE) {
    throw new Error(
      `STOP: expected ${EXPECTED_DATABASE}, got ${actualDatabase ?? 'unknown'}. No RBAC write allowed.`,
    );
  }

  console.log(`DB guard PASS: current_database() = ${actualDatabase}`);
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await assertDatabaseGuard(prisma);

    const directorRoles = await prisma.role.findMany({
      where: { code: 'DIRECTOR' },
      select: { id: true, workspaceId: true, code: true, name: true },
      orderBy: { workspaceId: 'asc' },
    });

    if (directorRoles.length === 0) {
      throw new Error('STOP: DIRECTOR role not found. No role creation is allowed in this bootstrap.');
    }

    const foremanRoles = await prisma.role.findMany({
      where: { code: 'FOREMAN' },
      select: { id: true, workspaceId: true, code: true, name: true },
      orderBy: { workspaceId: 'asc' },
    });

    // FOREMAN roles may not exist yet in all workspaces.
    // This is acceptable: the permission will be assigned to any FOREMAN roles that DO exist.
    // When FOREMAN roles are created for specific workspaces, this bootstrap must be re-run.
    console.log(`FOREMAN roles found: ${foremanRoles.length} (will assign FIELD_PROGRESS_SUBMIT to each)`);

    await prisma.$transaction(async (tx) => {
      const ensuredPermissions = await ensureCanonicalPermissions(tx);

      for (const role of directorRoles) {
        await assertNoForbiddenPermissions(tx, role.id, ensuredPermissions, DIRECTOR_FORBIDDEN_PERMISSION_CODES);
      }

      for (const role of directorRoles) {
        await grantPermissionsToRole(tx, role.id, ensuredPermissions, DIRECTOR_ALLOWED_PERMISSION_CODES);
      }

      // ── FOREMAN: grant FIELD_PROGRESS_SUBMIT ────────────────────────────
      // FOREMAN is a WRITE/SUBMIT role for field actors.
      // DIRECTOR, ACCEPTANCE_MEMBER, and any other role must NOT receive this permission.
      if (foremanRoles.length > 0) {
        for (const role of foremanRoles) {
          await grantPermissionsToRole(tx, role.id, ensuredPermissions, ['FIELD_PROGRESS_SUBMIT']);
        }
      }
    });

    console.log('RBAC permission bootstrap complete');
    console.log({
      permissionsEnsured: CANONICAL_PERMISSIONS.map((permission) => permission.code),
      directorRoleCount: directorRoles.length,
      directorGrantedPermissions: DIRECTOR_ALLOWED_PERMISSION_CODES,
      directorForbiddenPermissionsNotGranted: DIRECTOR_FORBIDDEN_PERMISSION_CODES,
      foremanRoleCount: foremanRoles.length,
      foremanGrantedPermissions: ['FIELD_PROGRESS_SUBMIT'],
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

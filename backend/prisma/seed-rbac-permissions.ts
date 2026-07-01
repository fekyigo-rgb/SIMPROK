import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/common/constants/permissions';

const prisma = new PrismaClient();

const EXPECTED_DATABASE = 'simprok_db';

const permissions = [
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
    code: PERMISSIONS.PROJECT_CREATE,
    name: 'Create Projects',
    description: 'Create or initiate project records where authorized.',
  },
];

const directorAllowedPermissionCodes = [
  'WORKSPACE_MEMBERSHIP_VIEW',
  'AUTHORITY_VIEW',
  'APPROVAL_MATRIX_VIEW',
  PERMISSIONS.PROJECT_CREATE,
];

const directorForbiddenPermissionCodes = [
  'WORKSPACE_MEMBERSHIP_MANAGE',
  'AUTHORITY_MANAGE',
  'AUTHORITY_ASSIGN',
  'APPROVAL_MATRIX_MANAGE',
  'FIELD_PROGRESS_SUBMIT', // DIRECTOR is view-only; must never submit field progress
];

async function assertDatabaseGuard(): Promise<void> {
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
  await assertDatabaseGuard();

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
    const ensuredPermissions = new Map<string, string>();

    for (const permission of permissions) {
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

    // ── DIRECTOR: forbidden permission guard ─────────────────────────────
    const forbiddenPermissionIds = directorForbiddenPermissionCodes
      .map((code) => ensuredPermissions.get(code))
      .filter((id): id is string => Boolean(id));

    const forbiddenMappings = await tx.rolePermission.findMany({
      where: {
        roleId: { in: directorRoles.map((role) => role.id) },
        permissionId: { in: forbiddenPermissionIds },
      },
      select: { roleId: true, permissionId: true },
    });

    if (forbiddenMappings.length > 0) {
      throw new Error(
        'STOP: DIRECTOR already has forbidden MANAGE/ASSIGN permission mapping. No cleanup is performed by this bootstrap.',
      );
    }

    // ── DIRECTOR: grant allowed VIEW permissions ─────────────────────────
    for (const role of directorRoles) {
      for (const code of directorAllowedPermissionCodes) {
        const permissionId = ensuredPermissions.get(code);

        if (!permissionId) {
          throw new Error(`STOP: permission ${code} was not ensured.`);
        }

        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId,
          },
        });
      }
    }

    // ── FOREMAN: grant FIELD_PROGRESS_SUBMIT ────────────────────────────
    // FOREMAN is a WRITE/SUBMIT role for field actors.
    // DIRECTOR, ACCEPTANCE_MEMBER, and any other role must NOT receive this permission.
    if (foremanRoles.length > 0) {
      const fieldProgressPermId = ensuredPermissions.get('FIELD_PROGRESS_SUBMIT');
      if (!fieldProgressPermId) {
        throw new Error('STOP: FIELD_PROGRESS_SUBMIT permission was not ensured.');
      }

      for (const role of foremanRoles) {
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: fieldProgressPermId,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: fieldProgressPermId,
          },
        });
      }
    }
  });

  console.log('RBAC permission bootstrap complete');
  console.log({
    permissionsEnsured: permissions.map((permission) => permission.code),
    directorRoleCount: directorRoles.length,
    directorGrantedPermissions: directorAllowedPermissionCodes,
    directorForbiddenPermissionsNotGranted: directorForbiddenPermissionCodes,
    foremanRoleCount: foremanRoles.length,
    foremanGrantedPermissions: ['FIELD_PROGRESS_SUBMIT'],
  });
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

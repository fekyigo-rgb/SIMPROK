import { PrismaClient } from '@prisma/client';

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
];

const directorAllowedPermissionCodes = [
  'WORKSPACE_MEMBERSHIP_VIEW',
  'AUTHORITY_VIEW',
  'APPROVAL_MATRIX_VIEW',
];

const directorForbiddenPermissionCodes = [
  'WORKSPACE_MEMBERSHIP_MANAGE',
  'AUTHORITY_MANAGE',
  'AUTHORITY_ASSIGN',
  'APPROVAL_MATRIX_MANAGE',
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
  });

  console.log('RBAC permission bootstrap complete');
  console.log({
    permissionsEnsured: permissions.map((permission) => permission.code),
    directorRoleCount: directorRoles.length,
    directorGrantedPermissions: directorAllowedPermissionCodes,
    directorForbiddenPermissionsNotGranted: directorForbiddenPermissionCodes,
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

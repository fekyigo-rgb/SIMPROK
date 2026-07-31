import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  applyRm02c3Activation,
  planRm02c3Activation,
  RM02C3_CONFIRMATION_TOKEN,
  RM02C3_PERMISSION_ALLOWLIST,
  type Rm02c3SqlClient,
  type Rm02c3Target,
} from '../../src/auth/rm02c3-basic-price-acceptance-activation';

function adapter(client: Client): Rm02c3SqlClient {
  return {
    query: async <T>(text: string, values?: readonly unknown[]) => {
      const result = await client.query(text, values ? [...values] : undefined);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
  };
}

describe('RM-02C3 acceptance permission activation (isolated E2E database)', () => {
  const prisma = new PrismaClient();
  const sql = new Client({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID();
  const target: Rm02c3Target = {
    databaseName: 'simprok_e2e',
    workspaceId: randomUUID(),
    workspaceName: `RM02C3 Target ${suffix}`,
    accountEmail: `rm02c3-target-${suffix}@test.local`,
    roleCode: `RM02C3_E2E_${suffix}`,
  };
  const sameWorkspaceControlEmail = `rm02c3-control-${suffix}@test.local`;
  const crossWorkspaceControlEmail = `rm02c3-cross-${suffix}@test.local`;
  const createdPermissionCodes: string[] = [];
  let organizationId: string;
  let targetAccountId: string;
  let targetMembershipId: string;

  beforeAll(async () => {
    await sql.connect();
    for (const { code } of RM02C3_PERMISSION_ALLOWLIST) {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (!existing) createdPermissionCodes.push(code);
    }

    const organization = await prisma.organization.create({
      data: { name: `RM02C3 Org ${suffix}`, type: 'COMPANY' },
    });
    organizationId = organization.id;
    await prisma.workspace.create({
      data: {
        id: target.workspaceId,
        name: target.workspaceName,
        organizationId,
      },
    });
    const crossWorkspace = await prisma.workspace.create({
      data: { name: `RM02C3 Cross ${suffix}`, organizationId },
    });
    const targetAccount = await prisma.account.create({
      data: {
        email: target.accountEmail,
        passwordHash: 'e2e-only-not-a-login-credential',
        displayName: 'RM02C3 Target',
        status: 'ACTIVE',
      },
    });
    targetAccountId = targetAccount.id;
    const targetMembership = await prisma.workspaceMembership.create({
      data: {
        accountId: targetAccount.id,
        workspaceId: target.workspaceId,
        status: 'ACTIVE',
      },
    });
    targetMembershipId = targetMembership.id;
    const sameControl = await prisma.account.create({
      data: {
        email: sameWorkspaceControlEmail,
        passwordHash: 'e2e-only-not-a-login-credential',
        displayName: 'RM02C3 Same Workspace Control',
        status: 'ACTIVE',
      },
    });
    await prisma.workspaceMembership.create({
      data: {
        accountId: sameControl.id,
        workspaceId: target.workspaceId,
        status: 'ACTIVE',
      },
    });
    const crossControl = await prisma.account.create({
      data: {
        email: crossWorkspaceControlEmail,
        passwordHash: 'e2e-only-not-a-login-credential',
        displayName: 'RM02C3 Cross Workspace Control',
        status: 'ACTIVE',
      },
    });
    await prisma.workspaceMembership.create({
      data: {
        accountId: crossControl.id,
        workspaceId: crossWorkspace.id,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { organizationId } });
    await prisma.account.deleteMany({
      where: {
        email: {
          in: [
            target.accountEmail,
            sameWorkspaceControlEmail,
            crossWorkspaceControlEmail,
          ],
        },
      },
    });
    await prisma.organization.delete({ where: { id: organizationId } });
    if (createdPermissionCodes.length) {
      await prisma.permission.deleteMany({
        where: { code: { in: createdPermissionCodes } },
      });
    }
    await sql.end();
    await prisma.$disconnect();
  });

  it('plans read-only, rolls back atomically, applies exact authority, isolates controls, and is idempotent', async () => {
    const before = {
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count(),
      rolePermissions: await prisma.rolePermission.count(),
      membershipRoles: await prisma.membershipRole.count(),
    };
    const plan = await planRm02c3Activation(adapter(sql), target);
    expect(plan.plan.expectedDelta.permissions).toBe(
      createdPermissionCodes.length,
    );
    expect({
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count(),
      rolePermissions: await prisma.rolePermission.count(),
      membershipRoles: await prisma.membershipRole.count(),
    }).toEqual(before);

    await expect(
      applyRm02c3Activation(adapter(sql), {
        confirmationToken: RM02C3_CONFIRMATION_TOKEN,
        expectedPlanSha256: plan.planSha256,
        target,
        injectFailureAfter: 'ROLE_PERMISSIONS',
      }),
    ).rejects.toThrow('INJECTED_RM02C3_FAILURE');
    expect(
      await prisma.role.count({
        where: { workspaceId: target.workspaceId, code: target.roleCode },
      }),
    ).toBe(0);

    if (createdPermissionCodes.includes('BASIC_PRICE_IMPORT')) {
      await prisma.permission.create({
        data: {
          code: 'BASIC_PRICE_IMPORT',
          name: 'Basic Price Import',
          description: 'E2E drift fixture.',
        },
      });
    } else {
      await prisma.role.create({
        data: {
          workspaceId: target.workspaceId,
          code: target.roleCode,
          name: 'E2E drift fixture',
        },
      });
    }
    await expect(
      applyRm02c3Activation(adapter(sql), {
        confirmationToken: RM02C3_CONFIRMATION_TOKEN,
        expectedPlanSha256: plan.planSha256,
        target,
      }),
    ).rejects.toThrow('STOP_PLAN_HASH_DRIFT');

    const freshPlan = await planRm02c3Activation(adapter(sql), target);
    const first = await applyRm02c3Activation(adapter(sql), {
      confirmationToken: RM02C3_CONFIRMATION_TOKEN,
      expectedPlanSha256: freshPlan.planSha256,
      target,
    });
    expect(first.rolePermissionCreatedDelta).toBe(2);
    expect(first.membershipRoleCreatedDelta).toBe(1);

    const role = await prisma.role.findUniqueOrThrow({
      where: {
        workspaceId_code: {
          workspaceId: target.workspaceId,
          code: target.roleCode,
        },
      },
      include: {
        rolePermissions: { include: { permission: true } },
        membershipRoles: { include: { workspaceMembership: true } },
      },
    });
    expect(
      role.rolePermissions.map(({ permission }) => permission.code).sort(),
    ).toEqual(RM02C3_PERMISSION_ALLOWLIST.map(({ code }) => code).sort());
    expect(role.membershipRoles).toHaveLength(1);
    expect(role.membershipRoles[0].workspaceMembershipId).toBe(
      targetMembershipId,
    );
    expect(role.membershipRoles[0].workspaceMembership.accountId).toBe(
      targetAccountId,
    );
    expect(
      await prisma.membershipRole.count({
        where: {
          roleId: role.id,
          workspaceMembership: {
            account: {
              email: {
                in: [sameWorkspaceControlEmail, crossWorkspaceControlEmail],
              },
            },
          },
        },
      }),
    ).toBe(0);

    const secondPlan = await planRm02c3Activation(adapter(sql), target);
    const second = await applyRm02c3Activation(adapter(sql), {
      confirmationToken: RM02C3_CONFIRMATION_TOKEN,
      expectedPlanSha256: secondPlan.planSha256,
      target,
    });
    expect(second).toMatchObject({
      permissionCreatedDelta: 0,
      roleCreatedDelta: 0,
      rolePermissionCreatedDelta: 0,
      membershipRoleCreatedDelta: 0,
    });
  });
});

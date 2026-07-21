import { PrismaClient } from '@prisma/client';
import {
  RM01_ALLOWLISTED_PERMISSION_CODES,
  applyActivation,
  planActivation,
} from '../../src/auth/rm01-permission-activation-planner';

/**
 * RM-01a-CODE §6.6 — proves the narrow activation planner PLANs and APPLYs
 * only against simprok_test, only touches one explicit workspace + the
 * DIRECTOR role in it, is additive-only, and is idempotent on re-apply.
 *
 * Uses a fully isolated throwaway Organization/Workspace/Role so nothing
 * here touches the shared workspace-A DIRECTOR role that other e2e specs in
 * this suite rely on holding zero permissions. Cascade-deletes everything it
 * creates in afterAll — RAB_VIEW/RAB_DRAFT_EDIT themselves are global
 * Permission rows that already exist in simprok_test and are never deleted.
 */
describe('RM-01a permission activation planner (e2e, simprok_test only)', () => {
  let prisma: PrismaClient;
  let orgId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let otherRoleId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { name: 'RM01 Planner Test Org', type: 'COMPANY' },
    });
    orgId = org.id;

    const workspace = await prisma.workspace.create({
      data: { name: 'RM01 Planner Test Workspace', organizationId: orgId },
    });
    workspaceId = workspace.id;
    await prisma.role.create({
      data: { workspaceId, code: 'DIRECTOR', name: 'Director (planner test)' },
    });

    // A second, untouched workspace+role pair used to prove non-interference.
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'RM01 Planner Untouched Workspace', organizationId: orgId },
    });
    otherWorkspaceId = otherWorkspace.id;
    const otherRole = await prisma.role.create({
      data: {
        workspaceId: otherWorkspaceId,
        code: 'DIRECTOR',
        name: 'Director (untouched)',
      },
    });
    otherRoleId = otherRole.id;
  });

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }); // cascades Role, RolePermission
    await prisma.workspace.delete({ where: { id: otherWorkspaceId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('1. refuses a target outside the RAB_VIEW/RAB_DRAFT_EDIT allowlist', async () => {
    await expect(
      planActivation(prisma, {
        workspaceId,
        roleCode: 'DIRECTOR',
        permissionCodes: ['AHSP_MANAGE'],
      }),
    ).rejects.toThrow(/allowlist/);
  });

  it('2. refuses a role code other than DIRECTOR', async () => {
    await expect(
      planActivation(prisma, {
        workspaceId,
        roleCode: 'FOREMAN',
        permissionCodes: ['RAB_VIEW'],
      }),
    ).rejects.toThrow(/DIRECTOR/);
  });

  it('3. refuses an empty/missing workspaceId (no wildcard target)', async () => {
    await expect(
      planActivation(prisma, {
        workspaceId: '',
        roleCode: 'DIRECTOR',
        permissionCodes: ['RAB_VIEW'],
      }),
    ).rejects.toThrow(/explicit workspace/);
  });

  it('4. PLAN is read-only: reports RAB_VIEW/RAB_DRAFT_EDIT already exist, and GRANT is intended (zero DB writes)', async () => {
    const plan = await planActivation(prisma, {
      workspaceId,
      roleCode: 'DIRECTOR',
      permissionCodes: [...RM01_ALLOWLISTED_PERMISSION_CODES],
    });

    expect(plan.ambiguous).toBe(false);
    for (const entry of plan.entries) {
      expect(entry.permissionExists).toBe(true);
      expect(entry.permissionAction).toBe('NONE');
      expect(entry.rolePermissionExists).toBe(false);
      expect(entry.rolePermissionAction).toBe('GRANT');
    }

    const grantCount = await prisma.rolePermission.count({
      where: { roleId: plan.roleId as string },
    });
    expect(grantCount).toBe(0);
  });

  it('5. APPLY without confirm:true is refused', async () => {
    await expect(
      applyActivation(
        prisma,
        { workspaceId, roleCode: 'DIRECTOR', permissionCodes: ['RAB_VIEW'] },
        {} as { confirm: true },
      ),
    ).rejects.toThrow(/confirm/);
  });

  it('6. APPLY grants exactly the allowlisted permissions and is idempotent on re-apply (delta 0)', async () => {
    const target = {
      workspaceId,
      roleCode: 'DIRECTOR',
      permissionCodes: [...RM01_ALLOWLISTED_PERMISSION_CODES],
    };

    const firstApply = await applyActivation(prisma, target, { confirm: true });
    expect(firstApply.changesApplied).toBe(
      RM01_ALLOWLISTED_PERMISSION_CODES.length,
    );
    for (const entry of firstApply.after.entries) {
      expect(entry.rolePermissionExists).toBe(true);
      expect(entry.rolePermissionAction).toBe('NONE');
    }

    const secondApply = await applyActivation(prisma, target, {
      confirm: true,
    });
    expect(secondApply.changesApplied).toBe(0);

    const grantedCodes = await prisma.rolePermission.findMany({
      where: { roleId: firstApply.after.roleId as string },
      select: { permission: { select: { code: true } } },
    });
    expect(grantedCodes.map((g) => g.permission.code).sort()).toEqual(
      [...RM01_ALLOWLISTED_PERMISSION_CODES].sort(),
    );
  });

  it('7. applying to one workspace/role never grants the other untouched workspace/role', async () => {
    const untouchedGrantCount = await prisma.rolePermission.count({
      where: { roleId: otherRoleId },
    });
    expect(untouchedGrantCount).toBe(0);
  });

  // The "refuses to run against simprok_db" guard is proven with a mocked
  // client in rm01-permission-activation-planner.spec.ts, never with a real
  // connection here — this contract forbids any simprok_db connection,
  // including a read-only one made only to prove a rejection.
});

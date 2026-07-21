import {
  planActivation,
  applyActivation,
  assertExpectedTestDatabase,
} from './rm01-permission-activation-planner';

/**
 * Unit-level coverage using a mocked Prisma client — no real database
 * connection is ever made here. In particular, the "refuses simprok_db"
 * path is proven this way rather than with a live connection, because this
 * RM-01a-CODE contract forbids any simprok_db connection, including a
 * read-only one made only to prove a rejection.
 */
describe('rm01-permission-activation-planner (unit, mocked client)', () => {
  const mockPrisma = (currentDatabase: string) => ({
    $queryRawUnsafe: jest
      .fn()
      .mockResolvedValue([{ current_database: currentDatabase }]),
    role: { findMany: jest.fn() },
    permission: { findUnique: jest.fn() },
    rolePermission: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  });

  it('1. assertExpectedTestDatabase throws for simprok_db without ever needing a real connection', async () => {
    const prisma = mockPrisma('simprok_db');
    await expect(assertExpectedTestDatabase(prisma as any)).rejects.toThrow(
      /forbidden production database/,
    );
  });

  it('2. assertExpectedTestDatabase throws for any database that is not simprok_test', async () => {
    const prisma = mockPrisma('some_other_db');
    await expect(assertExpectedTestDatabase(prisma as any)).rejects.toThrow(
      /simprok_test/,
    );
  });

  it('3. assertExpectedTestDatabase passes for simprok_test', async () => {
    const prisma = mockPrisma('simprok_test');
    await expect(
      assertExpectedTestDatabase(prisma as any),
    ).resolves.toBeUndefined();
  });

  it('4. planActivation never reaches the database guard for a disallowed permission code', async () => {
    const prisma = mockPrisma('simprok_test');
    await expect(
      planActivation(prisma as any, {
        workspaceId: 'ws-1',
        roleCode: 'DIRECTOR',
        permissionCodes: ['BASIC_PRICE_MANAGE'],
      }),
    ).rejects.toThrow(/allowlist/);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('5. planActivation reports ambiguous=true and performs zero writes when no matching role exists', async () => {
    const prisma = mockPrisma('simprok_test');
    prisma.role.findMany.mockResolvedValue([]);

    const plan = await planActivation(prisma as any, {
      workspaceId: 'ws-1',
      roleCode: 'DIRECTOR',
      permissionCodes: ['RAB_VIEW'],
    });

    expect(plan.ambiguous).toBe(true);
    expect(plan.roleId).toBeNull();
  });

  it('6. planActivation reports ambiguous=true when more than one role matches (fail-closed, never guesses)', async () => {
    const prisma = mockPrisma('simprok_test');
    prisma.role.findMany.mockResolvedValue([
      { id: 'role-1' },
      { id: 'role-2' },
    ]);

    const plan = await planActivation(prisma as any, {
      workspaceId: 'ws-1',
      roleCode: 'DIRECTOR',
      permissionCodes: ['RAB_VIEW'],
    });

    expect(plan.ambiguous).toBe(true);
    expect(plan.roleId).toBeNull();
  });

  it('7. applyActivation refuses an ambiguous target even with confirm:true (no $transaction call)', async () => {
    const prisma = mockPrisma('simprok_test');
    prisma.role.findMany.mockResolvedValue([]);

    await expect(
      applyActivation(
        prisma as any,
        {
          workspaceId: 'ws-1',
          roleCode: 'DIRECTOR',
          permissionCodes: ['RAB_VIEW'],
        },
        { confirm: true },
      ),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('8. a missing Permission row is planned as CREATE_PERMISSION, not silently skipped', async () => {
    const prisma = mockPrisma('simprok_test');
    prisma.role.findMany.mockResolvedValue([{ id: 'role-1' }]);
    prisma.permission.findUnique.mockResolvedValue(null);

    const plan = await planActivation(prisma as any, {
      workspaceId: 'ws-1',
      roleCode: 'DIRECTOR',
      permissionCodes: ['RAB_VIEW'],
    });

    expect(plan.entries[0]).toMatchObject({
      permissionExists: false,
      permissionAction: 'CREATE_PERMISSION',
    });
  });
});

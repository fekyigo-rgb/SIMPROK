import {
  CANONICAL_PERMISSIONS,
  DIRECTOR_ALLOWED_PERMISSION_CODES,
  ensureCanonicalPermissions,
} from '../../prisma/seed-rbac-permissions';
import {
  EXECUTION_PLAN_AUTHORITY_DEFINITION,
  provisionExecutionPlanAuthority,
  type ExecutionPlanAuthorityProvisioningClient,
} from '../../prisma/seed-execution-plan-authority';
import { PERMISSIONS } from '../common/constants/permissions';

describe('MON-04 Execution Plan provisioning boundaries', () => {
  it('upserts both Permission rows without granting them to the canonical production role', async () => {
    const definitions = new Map(
      CANONICAL_PERMISSIONS.map((permission) => [permission.code, permission]),
    );
    const upsert = jest.fn().mockImplementation(async ({ create }) => ({
      id: `permission-${create.code}`,
      ...create,
    }));
    const ensured = await ensureCanonicalPermissions({
      permission: { upsert },
    } as never);

    expect(definitions.get(PERMISSIONS.EXECUTION_PLAN_EDIT)).toMatchObject({
      name: 'Edit Execution Plan Draft',
    });
    expect(definitions.get(PERMISSIONS.EXECUTION_PLAN_LOCK)).toMatchObject({
      name: 'Lock Execution Plan',
    });
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).not.toContain(
      PERMISSIONS.EXECUTION_PLAN_EDIT,
    );
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).not.toContain(
      PERMISSIONS.EXECUTION_PLAN_LOCK,
    );
    expect(ensured.get(PERMISSIONS.EXECUTION_PLAN_EDIT)).toBe(
      'permission-EXECUTION_PLAN_EDIT',
    );
    expect(ensured.get(PERMISSIONS.EXECUTION_PLAN_LOCK)).toBe(
      'permission-EXECUTION_PLAN_LOCK',
    );
    for (const code of [
      PERMISSIONS.EXECUTION_PLAN_EDIT,
      PERMISSIONS.EXECUTION_PLAN_LOCK,
    ]) {
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code } }),
      );
    }
  });

  it('provisions only the EXECUTION_PLAN_LOCK Authority vocabulary row, with zero grants', async () => {
    const upsert = jest.fn().mockResolvedValue({
      id: 'authority-id',
      code: 'EXECUTION_PLAN_LOCK',
    });
    const client = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ current_database: 'simprok_db' }]),
      authority: { upsert },
    } as ExecutionPlanAuthorityProvisioningClient;

    await expect(provisionExecutionPlanAuthority(client)).resolves.toEqual({
      database: 'simprok_db',
      authorityId: 'authority-id',
      authorityCode: 'EXECUTION_PLAN_LOCK',
      grantsCreated: 0,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { code: EXECUTION_PLAN_AUTHORITY_DEFINITION.code },
      update: {
        name: EXECUTION_PLAN_AUTHORITY_DEFINITION.name,
        description: EXECUTION_PLAN_AUTHORITY_DEFINITION.description,
      },
      create: EXECUTION_PLAN_AUTHORITY_DEFINITION,
    });
    expect(client).not.toHaveProperty('positionAuthority');
  });

  it('refuses non-production database identity before any Authority write', async () => {
    const upsert = jest.fn();
    const client = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ current_database: 'simprok_e2e' }]),
      authority: { upsert },
    } as ExecutionPlanAuthorityProvisioningClient;

    await expect(provisionExecutionPlanAuthority(client)).rejects.toThrow(
      'STOP: expected simprok_db, got simprok_e2e. No Authority write allowed.',
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});

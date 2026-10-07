import {
  CANONICAL_PERMISSIONS,
  DIRECTOR_ALLOWED_PERMISSION_CODES,
} from '../../prisma/seed-rbac-permissions';
import {
  PROJECT_EXECUTION_START_AUTHORITY_DEFINITION,
  provisionProjectExecutionStartAuthority,
  type ProjectExecutionAuthorityProvisioningClient,
} from '../../prisma/seed-project-execution-authority';
import { PERMISSIONS } from '../common/constants/permissions';

describe('SR-01 Project execution governance provisioning', () => {
  it('provisions separate Permission and Authority vocabularies with zero grants', async () => {
    const permission = CANONICAL_PERMISSIONS.find(
      (candidate) => candidate.code === PERMISSIONS.PROJECT_EXECUTION_START,
    );
    expect(permission).toMatchObject({ name: 'Start Project Execution' });
    expect(DIRECTOR_ALLOWED_PERMISSION_CODES).not.toContain(
      PERMISSIONS.PROJECT_EXECUTION_START,
    );

    const upsert = jest.fn().mockResolvedValue({
      id: 'project-execution-start-authority-id',
      code: 'PROJECT_EXECUTION_START',
    });
    const client = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ current_database: 'simprok_db' }]),
      authority: { upsert },
    } as ProjectExecutionAuthorityProvisioningClient;

    await expect(
      provisionProjectExecutionStartAuthority(client),
    ).resolves.toEqual({
      database: 'simprok_db',
      authorityId: 'project-execution-start-authority-id',
      authorityCode: 'PROJECT_EXECUTION_START',
      grantsCreated: 0,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { code: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.code },
      update: {
        name: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.name,
        description: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION.description,
      },
      create: PROJECT_EXECUTION_START_AUTHORITY_DEFINITION,
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
    } as ProjectExecutionAuthorityProvisioningClient;

    await expect(provisionProjectExecutionStartAuthority(client)).rejects.toThrow(
      'STOP: expected simprok_db, got simprok_e2e. No Project execution Authority write allowed.',
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});

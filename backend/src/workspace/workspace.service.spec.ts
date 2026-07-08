import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let prisma: {
    workspace: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  const workspace = {
    id: 'workspace-1',
    name: 'SIMPROK Workspace',
    code: 'SIMPROK',
    organizationId: 'organization-1',
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = {
      workspace: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAllForAccount returns only workspaces for the given accountId, ordered by newest first', async () => {
    prisma.workspace.findMany.mockResolvedValue([workspace]);

    const accountId = 'test-account-id';
    await expect(service.findAllForAccount(accountId)).resolves.toEqual([workspace]);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      where: {
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('findOneForAccount returns a workspace only when account has active membership', async () => {
    prisma.workspace.findFirst.mockResolvedValue(workspace);

    const accountId = 'test-account-id';
    await expect(service.findOneForAccount(workspace.id, accountId)).resolves.toEqual(workspace);
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: {
        id: workspace.id,
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
    });
  });

  it('findOneForAccount throws NotFoundException when workspace is outside account scope', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);

    await expect(service.findOneForAccount('missing-workspace', 'test-account-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'missing-workspace',
        memberships: {
          some: {
            accountId: 'test-account-id',
            status: 'ACTIVE',
          },
        },
      },
    });
  });

  it('findByOrganizationForAccount returns organization workspaces scoped to account', async () => {
    prisma.workspace.findMany.mockResolvedValue([workspace]);

    const accountId = 'test-account-id';
    await expect(
      service.findByOrganizationForAccount(workspace.organizationId, accountId),
    ).resolves.toEqual([workspace]);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: workspace.organizationId,
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('healthCheck returns workspace module status', () => {
    expect(service.healthCheck()).toEqual({
      module: 'workspace',
      status: 'ok',
    });
  });
});

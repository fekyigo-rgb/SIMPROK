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

  it('findAll returns workspaces ordered by newest first', async () => {
    prisma.workspace.findMany.mockResolvedValue([workspace]);

    await expect(service.findAll()).resolves.toEqual([workspace]);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('findOne returns a workspace by id', async () => {
    prisma.workspace.findUnique.mockResolvedValue(workspace);

    await expect(service.findOne(workspace.id)).resolves.toEqual(workspace);
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
      where: {
        id: workspace.id,
      },
    });
  });

  it('findOne throws NotFoundException when workspace does not exist', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing-workspace')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'missing-workspace',
      },
    });
  });

  it('findByOrganization returns organization workspaces ordered by newest first', async () => {
    prisma.workspace.findMany.mockResolvedValue([workspace]);

    await expect(
      service.findByOrganization(workspace.organizationId),
    ).resolves.toEqual([workspace]);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: workspace.organizationId,
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

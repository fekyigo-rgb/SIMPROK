import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AhspController } from './ahsp.controller';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';

describe('AhspController', () => {
  let controller: AhspController;

  const ahspService = {
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    archive: jest.fn(),
    approve: jest.fn(),
    transfer: jest.fn(),
  };

  const ahspVersionService = {
    createVersion: jest.fn(),
    updateStatus: jest.fn(),
  };

  const ahspSnapshotService = {
    createSnapshot: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AhspController],
      providers: [
        { provide: AhspService, useValue: ahspService },
        { provide: AhspVersionService, useValue: ahspVersionService },
        { provide: AhspSnapshotService, useValue: ahspSnapshotService },
        // PermissionsGuard requires Reflector + PrismaService at instantiation time.
        // We provide minimal stubs so NestJS DI can resolve the guard in unit test context.
        // Guard logic itself is not under test here — we only verify class-level metadata.
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn().mockReturnValue([]) } },
        { provide: PrismaService, useValue: {} },
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get<AhspController>(AhspController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('requires JwtAuthGuard at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AhspController);
    expect(guards).toContain(JwtAuthGuard);
  });

  it('requires PermissionsGuard at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AhspController);
    expect(guards).toContain(PermissionsGuard);
  });

  it('getById passes workspaceId from workspaceContext to service', async () => {
    const request = {
      workspaceContext: { workspaceId: 'ws-golden-01' },
    };
    ahspService.getById.mockResolvedValue({ id: 'ahsp-01' });

    await controller.getById(request, 'ahsp-01');

    expect(ahspService.getById).toHaveBeenCalledWith('ahsp-01', 'ws-golden-01');
  });

  it('healthCheck returns module ok status', () => {
    expect(controller.healthCheck()).toEqual({ module: 'ahsp', status: 'ok' });
  });

  it('createSnapshot passes workspaceId from context and delegates to snapshotService', async () => {
    const request = {
      workspaceContext: { workspaceId: 'ws-golden-01' },
    };
    ahspSnapshotService.createSnapshot.mockResolvedValue({ id: 'snap-01' });

    await controller.createSnapshot(request, 'ver-01', { userId: 'user-01' });

    expect(ahspSnapshotService.createSnapshot).toHaveBeenCalledWith(
      'ver-01',
      'ws-golden-01',
      'user-01',
    );
  });
});

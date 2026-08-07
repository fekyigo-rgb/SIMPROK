import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import { AhspController } from './ahsp.controller';
import { AhspService } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';

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

  /** RM-03B: the actor is server-derived; the controller never reads body.userId. */
  const TRUSTED_ACTOR_ID = 'trusted-user-a';
  const trustedActorService = {
    resolveActorUserId: jest.fn().mockResolvedValue(TRUSTED_ACTOR_ID),
  };
  const requestWithContext = {
    workspaceContext: { workspaceId: 'ws-a', membershipId: 'membership-a' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AhspController],
      providers: [
        { provide: AhspService, useValue: ahspService },
        { provide: AhspVersionService, useValue: ahspVersionService },
        { provide: AhspSnapshotService, useValue: ahspSnapshotService },
        { provide: TrustedAhspActorService, useValue: trustedActorService },
        // PermissionsGuard requires Reflector + WorkspacePermissionResolverService at instantiation time.
        // We provide minimal stubs so NestJS DI can resolve the guard in unit test context.
        // Guard logic itself is not under test here — we only verify class-level metadata.
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn().mockReturnValue([]) },
        },
        { provide: WorkspacePermissionResolverService, useValue: {} },
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

  /**
   * RM-03B remediation: this test previously asserted the snapshot was
   * attributed to `body.userId` ('user-01') — it was locking the defect in
   * place. The workspace assertion it also made is preserved; only the actor
   * expectation changes, because the actor is now server-derived.
   */
  it('createSnapshot passes workspaceId from context and the TRUSTED actor', async () => {
    const request = {
      workspaceContext: { workspaceId: 'ws-golden-01', membershipId: 'm-01' },
    };
    ahspSnapshotService.createSnapshot.mockResolvedValue({ id: 'snap-01' });

    await controller.createSnapshot(request, 'ver-01', { userId: 'user-01' });

    expect(ahspSnapshotService.createSnapshot).toHaveBeenCalledWith(
      'ver-01',
      'ws-golden-01',
      TRUSTED_ACTOR_ID,
    );
  });

  /**
   * RM-03B ACTOR PROVENANCE.
   *
   * Every AHSP mutation records who did it. Each used to take that identity
   * from `body.userId`, so an authenticated User A could attribute their own
   * change to User B. The workspace was already trusted, so this never leaked
   * data across tenants — the damage was to the audit trail, which is the
   * product itself here.
   *
   * `SPOOFED` below is what a malicious client sends. It must reach no writer.
   */
  describe('actor provenance is server-derived, never client-supplied', () => {
    const SPOOFED = 'attacker-chosen-user-b';

    it('create attributes to the trusted actor and drops the client actor and workspace', async () => {
      await controller.create(requestWithContext, {
        userId: SPOOFED,
        workspaceId: 'ws-somewhere-else',
        workType: 'W',
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: 'M',
      } as any);

      const [payload] = ahspService.create.mock.calls[0];
      expect(payload.userId).toBe(TRUSTED_ACTOR_ID);
      expect(payload.userId).not.toBe(SPOOFED);
      expect(payload.workspaceId).toBe('ws-a');
      expect(JSON.stringify(payload)).not.toContain(SPOOFED);
      expect(JSON.stringify(payload)).not.toContain('ws-somewhere-else');
    });

    it('createVersion attributes to the trusted actor and drops the client actor', async () => {
      await controller.createVersion(requestWithContext, 'ahsp-1', {
        userId: SPOOFED,
        workspaceId: 'ws-somewhere-else',
        outputUnit: 'M1',
        resources: [],
      } as any);

      const [, payload] = ahspVersionService.createVersion.mock.calls[0];
      expect(payload.userId).toBe(TRUSTED_ACTOR_ID);
      expect(payload.workspaceId).toBe('ws-a');
      expect(JSON.stringify(payload)).not.toContain(SPOOFED);
    });

    it.each([
      ['update', () => controller.update(requestWithContext, 'a', { userId: SPOOFED, reason: 'r' } as any), () => ahspService.update.mock.calls[0][2]],
      ['delete', () => controller.delete(requestWithContext, 'a', { userId: SPOOFED, reason: 'r' }), () => ahspService.delete.mock.calls[0][1]],
      ['archive', () => controller.archive(requestWithContext, 'a', { userId: SPOOFED, reason: 'r' }), () => ahspService.archive.mock.calls[0][1]],
      ['approve', () => controller.approve(requestWithContext, 'a', { userId: SPOOFED }), () => ahspService.approve.mock.calls[0][1]],
      ['transfer', () => controller.transfer(requestWithContext, 'a', { userId: SPOOFED, reason: 'r', targetOwnershipType: 'USER_ASSET' as any }), () => ahspService.transfer.mock.calls[0][2]],
      ['createSnapshot', () => controller.createSnapshot(requestWithContext, 'v', { userId: SPOOFED }), () => ahspSnapshotService.createSnapshot.mock.calls[0][2]],
    ])('%s ignores a client-supplied actor', async (_name, invoke, actorArg) => {
      await invoke();
      expect(actorArg()).toBe(TRUSTED_ACTOR_ID);
      expect(actorArg()).not.toBe(SPOOFED);
    });

    it('resolves the actor from the workspace context, never from the body', async () => {
      await controller.create(requestWithContext, {
        userId: SPOOFED,
        workType: 'W',
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: 'M',
      } as any);

      expect(trustedActorService.resolveActorUserId).toHaveBeenCalledWith(
        requestWithContext.workspaceContext,
      );
    });

    it('refuses the mutation when no trusted actor can be resolved — no fallback', async () => {
      trustedActorService.resolveActorUserId.mockRejectedValueOnce(
        new ForbiddenException('NO_TRUSTED_USER_PROFILE'),
      );

      await expect(
        controller.create(requestWithContext, {
          userId: SPOOFED,
          workType: 'W',
          methodType: 'MANUAL',
          locationType: 'GENERAL',
          methodName: 'M',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // The writer must never have been reached: no actorless AHSP, and no
      // quiet fall back to the body actor.
      expect(ahspService.create).not.toHaveBeenCalled();
    });
  });
});

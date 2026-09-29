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
import { AhspDocumentCanonicalizationService } from './services/ahsp-document-canonicalization.service';
import { AhspImportAssistedClassificationService } from './services/ahsp-import-assisted-classification.service';
import { AhspClassificationAssignmentService } from './services/ahsp-classification-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { BasicPriceImportLookupService } from '../basic-price/basic-price-import-lookup.service';
import { ResourceObservationService } from '../resource-catalog/resource-observation.service';

describe('AhspController', () => {
  let controller: AhspController;

  const ahspService = {
    list: jest.fn(),
    create: jest.fn(),
    getById: jest.fn(),
    getDetail: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    archive: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    propose: jest.fn(),
    transfer: jest.fn(),
  };

  const ahspVersionService = {
    createVersion: jest.fn(),
    updateStatus: jest.fn(),
  };

  const ahspSnapshotService = {
    createSnapshot: jest.fn(),
  };
  const documents = {
    previewUpload: jest.fn(),
    commitUpload: jest.fn(),
    listImportJobs: jest.fn(),
    continueImportJob: jest.fn(),
  };
  const assignments = {
    addAssignment: jest.fn(),
    listAssignments: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({})),
  };
  const assistedClassification = {
    listRoots: jest.fn(),
    listChildren: jest.fn(),
    search: jest.fn(),
    createLocalNode: jest.fn(),
    loadJobContext: jest.fn(),
    saveJobContext: jest.fn(),
    applyToAhsp: jest.fn(),
  };

  const resourceLookup = {
    searchResources: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 12, total: 0 }),
  };
  const observations = {
    ensureHandBuiltObservations: jest.fn().mockResolvedValue({ ensured: 0 }),
  };
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
        { provide: AhspDocumentCanonicalizationService, useValue: documents },
        {
          provide: AhspImportAssistedClassificationService,
          useValue: assistedClassification,
        },
        { provide: AhspClassificationAssignmentService, useValue: assignments },
        { provide: PrismaService, useValue: prisma },
        { provide: BasicPriceImportLookupService, useValue: resourceLookup },
        { provide: ResourceObservationService, useValue: observations },
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
    ahspService.getDetail.mockResolvedValue({ id: 'ahsp-01' });

    await controller.getById(request, 'ahsp-01');

    expect(ahspService.getDetail).toHaveBeenCalledWith('ahsp-01', 'ws-golden-01');
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

    it('createManual is one transaction: version failure does not return success, and assignments are HUMAN_ADDED', async () => {
      ahspService.create.mockResolvedValue({ id: 'ahsp-new', keterangan: 'catatan' });
      ahspVersionService.createVersion.mockResolvedValue({ id: 'ver-1' });
      assignments.addAssignment.mockResolvedValue({
        id: 'asg-1',
        provenance: 'HUMAN_ADDED',
      });

      const saved = await controller.createManual(requestWithContext as any, {
        methodName: 'Galian',
        outputUnit: 'm3',
        keterangan: 'catatan',
        leafNodeIds: ['leaf-1', 'leaf-1', 'leaf-2'],
        resources: [],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(ahspService.create).toHaveBeenCalledWith(
        expect.objectContaining({ keterangan: 'catatan', methodName: 'Galian' }),
        expect.anything(),
      );
      expect(assignments.addAssignment).toHaveBeenCalledTimes(2);
      expect(assignments.addAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          leafNodeId: 'leaf-1',
          provenance: 'HUMAN_ADDED',
          actingWorkspaceId: 'ws-a',
        }),
        expect.anything(),
      );
      expect(saved).toEqual(
        expect.objectContaining({ id: 'ahsp-new', keterangan: 'catatan' }),
      );

      ahspVersionService.createVersion.mockRejectedValueOnce(new Error('UNIT'));
      await expect(
        controller.createManual(requestWithContext as any, {
          methodName: 'Galian',
          outputUnit: 'zzz',
          leafNodeIds: ['leaf-1'],
        }),
      ).rejects.toThrow('UNIT');
    });

    it('keeps the committed Manual save successful when post-commit review preparation is temporarily unavailable', async () => {
      ahspService.create.mockResolvedValue({ id: 'ahsp-post-commit', keterangan: null });
      ahspVersionService.createVersion.mockResolvedValue({ id: 'ver-post-commit' });
      observations.ensureHandBuiltObservations.mockRejectedValueOnce(new Error('OBSERVATION_TEMPORARILY_UNAVAILABLE'));

      const saved = await controller.createManual(requestWithContext as any, {
        methodName: 'Manual tetap tersimpan',
        outputUnit: 'm3',
        resources: [],
      });

      expect(saved).toEqual(
        expect.objectContaining({
          id: 'ahsp-post-commit',
          resourceReviewPrepared: false,
        }),
      );
      expect(ahspService.create).toHaveBeenCalledTimes(1);
      expect(ahspVersionService.createVersion).toHaveBeenCalledTimes(1);
    });
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

    it('previewDocument uses the guard workspace and JWT account, never a client workspace', async () => {
      const file = { buffer: Buffer.from('xlsx'), originalname: 'AHSP ok(1).xlsx' };
      await controller.previewDocument(
        { ...requestWithContext, user: { id: 'account-a' } },
        file,
      );
      expect(documents.previewUpload).toHaveBeenCalledWith({
        file,
        workspaceId: 'ws-a',
        actorAccountId: 'account-a',
      });
    });

    it('document preview and commit require the existing AHSP_MANAGE permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AhspController.prototype.previewDocument)).toEqual([
        'AHSP_MANAGE',
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AhspController.prototype.commitDocument)).toEqual([
        'AHSP_MANAGE',
      ]);
    });

    it('document preview refuses without a workspace and never reads a client workspace', async () => {
      const file = { buffer: Buffer.from('xlsx'), originalname: 'AHSP.xlsx' };
      await expect(
        controller.previewDocument(
          { query: { workspaceId: 'ws-other' }, body: { workspaceId: 'ws-other' }, user: { id: 'account-a' } },
          file,
        ),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      expect(documents.previewUpload).not.toHaveBeenCalled();
    });

    it('document commit refuses without a workspace and does not write', async () => {
      const file = { buffer: Buffer.from('xlsx'), originalname: 'AHSP.xlsx' };
      await expect(
        controller.commitDocument({ user: { id: 'account-a' } }, file),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      expect(trustedActorService.resolveActorUserId).not.toHaveBeenCalled();
      expect(documents.commitUpload).not.toHaveBeenCalled();
    });

    it('commitDocument attributes the write to the trusted actor', async () => {
      const file = { buffer: Buffer.from('xlsx'), originalname: 'AHSP ok(1).xlsx' };
      await controller.commitDocument(
        { ...requestWithContext, user: { id: 'account-a' } },
        file,
      );
      expect(documents.commitUpload).toHaveBeenCalledWith({
        file,
        workspaceId: 'ws-a',
        actorAccountId: 'account-a',
        userId: TRUSTED_ACTOR_ID,
        // No multipart `decisions` field on this request -> an empty, safe default.
        decisions: [],
        assistedClassification: null,
      });
    });

    it('IMPORT-SEAM-05: listing and continuing an import require AHSP_MANAGE, like commit', () => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AhspController.prototype.listImportJobs,
        ),
      ).toEqual(['AHSP_MANAGE']);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AhspController.prototype.continueImportJob,
        ),
      ).toEqual(['AHSP_MANAGE']);
    });

    it('IMPORT-SEAM-05: continuing an import reads the guard workspace and the trusted actor, never the body', async () => {
      const decisions = [
        {
          workType: 'B.13',
          methodName: 'Gorong-gorong',
          action: 'KEEP_SEPARATE',
        },
      ];
      await controller.continueImportJob(
        { ...requestWithContext, user: { id: 'account-a' } },
        'job-1',
        { decisions, workspaceId: 'ws-other', userId: 'someone-else' } as any,
      );
      expect(documents.continueImportJob).toHaveBeenCalledWith({
        workspaceId: 'ws-a',
        importJobId: 'job-1',
        userId: TRUSTED_ACTOR_ID,
        decisions,
        assistedClassification: null,
      });
    });

    it('IMPORT-SEAM-05: import listing and continuation refuse without a workspace and do nothing', async () => {
      await expect(
        controller.listImportJobs({ user: { id: 'account-a' } }),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      await expect(
        controller.continueImportJob(
          { user: { id: 'account-a' } },
          'job-1',
          {},
        ),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      expect(documents.listImportJobs).not.toHaveBeenCalled();
      expect(documents.continueImportJob).not.toHaveBeenCalled();
      expect(trustedActorService.resolveActorUserId).not.toHaveBeenCalled();
    });
  });
  /**
   * THE standalone AHSP discovery door.
   *
   * These prove the door is a door: it is reachable, it is guarded by the
   * permission the rest of this controller already uses, it takes its workspace
   * from the verified context rather than the caller, and it does not shadow or
   * get shadowed by its two neighbours.
   */
  describe('workspace AHSP discovery door', () => {
    it('is GET on the collection path, distinct from health and :id', () => {
      expect(Reflect.getMetadata('path', AhspController.prototype.list)).toBe('/');
      expect(Reflect.getMetadata('method', AhspController.prototype.list)).toBe(0);
      expect(Reflect.getMetadata('path', AhspController.prototype.healthCheck)).toBe('health');
      expect(Reflect.getMetadata('path', AhspController.prototype.getById)).toBe(':id');
    });

    it('requires the existing canonical AHSP_VIEW permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AhspController.prototype.list)).toEqual([
        'AHSP_VIEW',
      ]);
    });

    it('reads the workspace from the guard-verified context', async () => {
      ahspService.list.mockResolvedValue([]);
      await controller.list({ workspaceContext: { workspaceId: 'ws-golden-01' } });
      expect(ahspService.list).toHaveBeenCalledWith('ws-golden-01');
    });

    it('refuses without a workspace context and never takes one from the caller', async () => {
      // A forged query/body workspace must not become the tenant boundary, and
      // an absent context is a refusal rather than an unscoped read.
      await expect(
        controller.list({ query: { workspaceId: 'ws-other' }, body: { workspaceId: 'ws-other' } }),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      expect(ahspService.list).not.toHaveBeenCalled();
    });

    it('returns what the service returned, unreshaped', async () => {
      const rows = [{ id: 'ahsp-1', workType: 'Concrete Work' }];
      ahspService.list.mockResolvedValue(rows);
      await expect(controller.list(requestWithContext)).resolves.toBe(rows);
    });

    it('leaves the neighbouring routes working', async () => {
      expect(controller.healthCheck()).toEqual({ module: 'ahsp', status: 'ok' });
      ahspService.getDetail.mockResolvedValue({ id: 'ahsp-01' });
      await controller.getById(requestWithContext, 'ahsp-01');
      expect(ahspService.getDetail).toHaveBeenCalledWith('ahsp-01', 'ws-a');
    });
  });

  describe('Manual resource search door', () => {
    it('is GET resource-search under AHSP_MANAGE, not BASIC_PRICE_RESOLVE', () => {
      expect(Reflect.getMetadata('path', AhspController.prototype.searchManualResources)).toBe(
        'resource-search',
      );
      expect(Reflect.getMetadata('method', AhspController.prototype.searchManualResources)).toBe(0);
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, AhspController.prototype.searchManualResources),
      ).toEqual(['AHSP_MANAGE']);
    });

    it('delegates to the existing catalog lookup and writes nothing', async () => {
      await controller.searchManualResources(requestWithContext, { q: 'semen', page: 1, limit: 12 });
      expect(resourceLookup.searchResources).toHaveBeenCalledWith(
        'ws-a',
        { q: 'semen', page: 1, limit: 12 },
        'WORKSPACE_PLUS_GLOBAL',
      );
      expect(ahspService.create).not.toHaveBeenCalled();
    });

    it('refuses without a workspace context', async () => {
      await expect(
        controller.searchManualResources({} as never, { q: 'semen' }),
      ).rejects.toThrow('AHSP_WORKSPACE_CONTEXT_REQUIRED');
      expect(resourceLookup.searchResources).not.toHaveBeenCalled();
    });
  });
});

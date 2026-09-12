import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressAuthorityService } from '../progress/progress-authority.service';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { PERMISSIONS } from '../common/constants/permissions';
import { RAB_STATUS } from './rab-lifecycle-policy.service';
import {
  RAB_APPROVAL_AUTHORITY,
  RAB_APPROVAL_GATE_BLOCKER,
  RAB_APPROVAL_REASON,
} from './rab-approval.contracts';
import { RabApprovalService } from './rab-approval.service';

/**
 * PAB-03 — LOCKED → APPROVED → ACTIVE ProjectBaseline.
 *
 * Nothing in the production path knows a project id, a Position code, or an
 * organization. Every fixture below is ordinary data; the bridge decides on
 * lifecycle state and on what the EXISTING authority chain answers, which is
 * exactly why the same mechanism serves PPK, Direktur, Owner and Ketua
 * without a branch (see the genericity block at the end).
 */
describe('RabApprovalService', () => {
  const projectId = 'project-1';
  const workspaceId = 'workspace-1';
  const actorAccountId = 'account-1';
  const structureId = 'structure-1';
  const rabId = 'rab-1';
  const positionId = 'position-1';

  let service: RabApprovalService;
  let tx: any;
  let prisma: any;
  let authority: {
    requireWithinTransaction: jest.Mock;
    resolve: jest.Mock;
  };

  const projectAccess = (
    overrides: Partial<ProjectAccessContext> = {},
  ): ProjectAccessContext =>
    ({
      projectId,
      workspaceId,
      projectStatus: 'PLANNED',
      membershipId: 'membership-1',
      assignmentId: 'assignment-1',
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: true,
      roles: [],
      ...overrides,
    }) as ProjectAccessContext;

  /** A whole, lawful lock fact — the only thing approval will act on. */
  const lockedRab = (overrides: Record<string, unknown> = {}) => ({
    id: rabId,
    name: 'Working Draft RAB',
    status: RAB_STATUS.LOCKED,
    totalBaseCost: new Prisma.Decimal('129826295.00'),
    totalFinalCost: new Prisma.Decimal('158517906.20'),
    lockedAt: new Date('2026-09-01T02:00:00.000Z'),
    lockedByAccountId: 'account-locker',
    lockedFromStatus: RAB_STATUS.DRAFT,
    ...overrides,
  });

  const createdBaseline = (overrides: Record<string, unknown> = {}) => ({
    id: 'baseline-1',
    projectId,
    rabDocumentId: rabId,
    versionNumber: 1,
    status: 'ACTIVE',
    approvedAt: new Date('2026-09-12T03:00:00.000Z'),
    approvedByPositionId: positionId,
    justification: null,
    ...overrides,
  });

  const arrange = (
    opts: {
      rab?: any;
      project?: any[];
      structures?: any[];
      rabDocuments?: any[];
      baselineRows?: any[];
      matrixRows?: any[];
      updateCount?: number;
      baseline?: any;
      settledBaseline?: any;
      createThrows?: Error;
      holderPositionId?: string;
      holderPositionCode?: string;
    } = {},
  ) => {
    const rab = opts.rab ?? lockedRab();
    tx = {
      // 1st call: the project FOR UPDATE. 2nd: project_baselines FOR UPDATE.
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(opts.project ?? [{ id: projectId, workspaceId }])
        .mockResolvedValueOnce(opts.baselineRows ?? []),
      boqStructure: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts.structures ?? [{ id: structureId }]),
      },
      rabDocument: {
        findMany: jest.fn().mockResolvedValue(opts.rabDocuments ?? [rab]),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.updateCount ?? 1 }),
      },
      approvalMatrix: {
        findMany: jest.fn().mockResolvedValue(opts.matrixRows ?? []),
      },
      projectBaseline: {
        create: opts.createThrows
          ? jest.fn().mockRejectedValue(opts.createThrows)
          : jest.fn().mockResolvedValue(opts.baseline ?? createdBaseline()),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(opts.settledBaseline ?? createdBaseline()),
      },
    };
    authority.requireWithinTransaction.mockResolvedValue({
      positionId: opts.holderPositionId ?? positionId,
      positionCode: opts.holderPositionCode ?? 'PPK',
      authorityCode: RAB_APPROVAL_AUTHORITY,
    });
    return { tx, rab };
  };

  beforeEach(async () => {
    authority = {
      requireWithinTransaction: jest.fn(),
      resolve: jest.fn(),
    };
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      boqStructure: { findMany: jest.fn().mockResolvedValue([{ id: structureId }]) },
      projectBaseline: { count: jest.fn().mockResolvedValue(0) },
      positionAuthority: { findMany: jest.fn().mockResolvedValue([]) },
      rabDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabApprovalService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProgressAuthorityService, useValue: authority },
      ],
    }).compile();
    service = module.get(RabApprovalService);
  });

  const approve = (justification?: string) =>
    service.approveLockedRab({
      projectId,
      workspaceId,
      actorAccountId,
      projectAccess: projectAccess(),
      justification,
    });

  // ── A. THE HAPPY PATH ────────────────────────────────────────────────────
  it('A: a LOCKED RAB approved by the configured holder becomes APPROVED with one ACTIVE baseline', async () => {
    arrange();

    const result = await approve('Disetujui sesuai kewenangan.');

    expect(result).toMatchObject({
      status: RAB_STATUS.APPROVED,
      changed: true,
      rabDocumentId: rabId,
      projectId,
      approvedByPositionId: positionId,
      authorityCode: RAB_APPROVAL_AUTHORITY,
    });

    // The transition is scoped to LOCKED, so a race can only transition once.
    expect(tx.rabDocument.updateMany).toHaveBeenCalledWith({
      where: { id: rabId, status: RAB_STATUS.LOCKED },
      data: { status: RAB_STATUS.APPROVED },
    });

    // The baseline is created in the SAME transaction, from the SAME client.
    const created = tx.projectBaseline.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      projectId,
      rabDocumentId: rabId,
      versionNumber: 1,
      status: 'ACTIVE',
      // AUTHORITY BELONGS TO POSITION — the baseline records the Position,
      // never the person, so the fact survives the holder changing.
      approvedByPositionId: positionId,
      justification: 'Disetujui sesuai kewenangan.',
    });
    expect(created.approvedAt).toBeInstanceOf(Date);
  });

  // ── I. LINEAGE ───────────────────────────────────────────────────────────
  it('I: the baseline names the exact RAB that was approved', async () => {
    arrange();
    const result: any = await approve();
    expect(result.baseline.rabDocumentId).toBe(result.rabDocumentId);
    expect(result.baseline.status).toBe('ACTIVE');
    expect(result.baseline.projectId).toBe(projectId);
  });

  it('numbers the next baseline from the project own history, active or not', async () => {
    arrange({
      baselineRows: [
        { id: 'b1', rabDocumentId: 'rab-old-1', versionNumber: 1, status: 'SUPERSEDED' },
        { id: 'b2', rabDocumentId: 'rab-old-2', versionNumber: 2, status: 'SUPERSEDED' },
      ],
      baseline: createdBaseline({ id: 'baseline-3', versionNumber: 3 }),
    });
    await approve();
    expect(tx.projectBaseline.create.mock.calls[0][0].data.versionNumber).toBe(3);
  });

  // ── B. DRAFT IS NOT APPROVABLE ───────────────────────────────────────────
  it('B: a DRAFT RAB is refused and stays DRAFT — approval never locks on the Owner behalf', async () => {
    arrange({ rab: lockedRab({ status: RAB_STATUS.DRAFT, lockedAt: null, lockedByAccountId: null, lockedFromStatus: null }) });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.RAB_NOT_LOCKED,
      rabStatus: RAB_STATUS.DRAFT,
    });
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  // ── C / D / E. AUTHORITY GATES ───────────────────────────────────────────
  it('D: permission without organizational authority is refused, and nothing is written', async () => {
    arrange();
    authority.requireWithinTransaction.mockRejectedValue(
      new ForbiddenException('DECISION_AUTHORITY_REQUIRED'),
    );

    await expect(approve()).rejects.toThrow('DECISION_AUTHORITY_REQUIRED');
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('E: a revoked authority grant is refused even though the Position still exists', async () => {
    arrange();
    authority.requireWithinTransaction.mockRejectedValue(
      new ForbiddenException('DECISION_AUTHORITY_REVOKED'),
    );

    await expect(approve()).rejects.toThrow('DECISION_AUTHORITY_REVOKED');
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('C: an actor whose project assignment was revoked is refused', async () => {
    arrange();
    authority.requireWithinTransaction.mockRejectedValue(
      new ForbiddenException('PROJECT_ASSIGNMENT_REVOKED'),
    );

    await expect(approve()).rejects.toThrow('PROJECT_ASSIGNMENT_REVOKED');
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('asks the authority chain BEFORE reading the RAB, so an unauthorized caller learns nothing about it', async () => {
    arrange();
    authority.requireWithinTransaction.mockRejectedValue(
      new ForbiddenException('DECISION_AUTHORITY_REQUIRED'),
    );

    await expect(approve()).rejects.toThrow();
    expect(tx.boqStructure.findMany).not.toHaveBeenCalled();
    expect(tx.rabDocument.findMany).not.toHaveBeenCalled();
  });

  it('asks the authority chain for the generic RAB_APPROVE act, inside the transaction', async () => {
    arrange();
    await approve();
    expect(authority.requireWithinTransaction).toHaveBeenCalledWith(
      tx,
      actorAccountId,
      expect.objectContaining({ projectId, workspaceId }),
      'RAB_APPROVE',
    );
  });

  // ── F. TENANT / PROJECT SCOPE ────────────────────────────────────────────
  it('F: a project in another workspace is not found, and no authority is even resolved', async () => {
    arrange({ project: [{ id: projectId, workspaceId: 'workspace-OTHER' }] });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.PROJECT_NOT_FOUND,
    });
    expect(authority.requireWithinTransaction).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('F: a guard context naming a different project than the route is refused', async () => {
    arrange();
    const result: any = await service.approveLockedRab({
      projectId,
      workspaceId,
      actorAccountId,
      projectAccess: projectAccess({ projectId: 'project-OTHER' }),
    });
    expect(result).toMatchObject({ reason: RAB_APPROVAL_REASON.PROJECT_NOT_FOUND });
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('F: a missing project is not found', async () => {
    arrange({ project: [] });
    const result: any = await approve();
    expect(result).toMatchObject({ reason: RAB_APPROVAL_REASON.PROJECT_NOT_FOUND });
  });

  // ── G. TRANSACTION FAILURE ───────────────────────────────────────────────
  it('G: if the baseline cannot be written the whole act fails — the RAB is never left APPROVED alone', async () => {
    arrange({ createThrows: new Error('db down') });

    await expect(approve()).rejects.toThrow('db down');

    // The status update was attempted inside the SAME transaction that failed,
    // so it rolls back with it. What must never happen is the command
    // reporting success, or swallowing the failure and returning a refusal
    // while the RAB sits APPROVED.
    expect(tx.projectBaseline.create).toHaveBeenCalled();
  });

  // ── H. ONE ACTIVE BASELINE PER PROJECT ───────────────────────────────────
  it('H: a project that already has an ACTIVE baseline is refused', async () => {
    arrange({
      baselineRows: [
        { id: 'b1', rabDocumentId: 'rab-other', versionNumber: 1, status: 'ACTIVE' },
      ],
    });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.ACTIVE_BASELINE_EXISTS,
    });
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('H: losing the race reports the settled status and creates no second baseline', async () => {
    arrange({ updateCount: 0 });
    tx.rabDocument.findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(lockedRab({ status: RAB_STATUS.APPROVED }));

    const result: any = await approve();

    // The loser never invents the winner's baseline, and never claims a
    // conflict it did not observe — it reports what the row now says.
    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.RAB_NOT_LOCKED,
      rabStatus: RAB_STATUS.APPROVED,
    });
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  // ── IDEMPOTENCY ──────────────────────────────────────────────────────────
  it('re-approving an already APPROVED RAB is an idempotent no-op, not a second baseline', async () => {
    arrange({
      rab: lockedRab({ status: RAB_STATUS.APPROVED }),
      baselineRows: [
        { id: 'baseline-1', rabDocumentId: rabId, versionNumber: 1, status: 'ACTIVE' },
      ],
    });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: RAB_STATUS.APPROVED,
      changed: false,
      rabDocumentId: rabId,
    });
    expect(result.baseline.id).toBe('baseline-1');
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('an APPROVED RAB with no ACTIVE baseline is reported, never silently back-filled', async () => {
    arrange({ rab: lockedRab({ status: RAB_STATUS.APPROVED }), baselineRows: [] });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.APPROVED_WITHOUT_ACTIVE_BASELINE,
    });
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  // ── LOCK INTEGRITY ───────────────────────────────────────────────────────
  it('refuses to approve a LOCKED row that cannot say who froze it', async () => {
    arrange({ rab: lockedRab({ lockedByAccountId: null }) });

    const result: any = await approve();

    expect(result).toMatchObject({
      status: 'REFUSED',
      reason: RAB_APPROVAL_REASON.RAB_LOCK_PROVENANCE_CORRUPT,
    });
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('refuses when the project RAB is ambiguous', async () => {
    arrange({ structures: [{ id: 'a' }, { id: 'b' }] });
    const result: any = await approve();
    expect(result).toMatchObject({
      reason: RAB_APPROVAL_REASON.AMBIGUOUS_WORKING_DRAFT,
    });
  });

  it('refuses when the project has no RAB document', async () => {
    arrange({ rabDocuments: [] });
    const result: any = await approve();
    expect(result).toMatchObject({
      reason: RAB_APPROVAL_REASON.RAB_DOCUMENT_NOT_FOUND,
    });
  });

  // ── APPROVAL MATRIX, WHERE THE ORGANIZATION CONFIGURED ONE ───────────────
  it('an unconfigured ApprovalMatrix leaves the authority chain in charge', async () => {
    arrange({ matrixRows: [] });
    const result: any = await approve();
    expect(result.status).toBe(RAB_STATUS.APPROVED);
  });

  it('a configured matrix that does not name the holder Position refuses', async () => {
    arrange({
      matrixRows: [
        { requiredPositionId: 'position-OTHER', minValue: null, maxValue: null },
      ],
    });

    const result: any = await approve();

    expect(result).toMatchObject({
      reason: RAB_APPROVAL_REASON.APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED,
    });
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
  });

  it('a RAB above the holder configured value band refuses', async () => {
    arrange({
      matrixRows: [
        {
          requiredPositionId: positionId,
          minValue: new Prisma.Decimal('0'),
          maxValue: new Prisma.Decimal('1000000.00'),
        },
      ],
    });

    const result: any = await approve();

    expect(result).toMatchObject({
      reason: RAB_APPROVAL_REASON.APPROVAL_MATRIX_VALUE_OUT_OF_BAND,
    });
  });

  it('a RAB inside the holder configured value band is approved', async () => {
    arrange({
      matrixRows: [
        {
          requiredPositionId: positionId,
          minValue: new Prisma.Decimal('1000000.00'),
          maxValue: new Prisma.Decimal('900000000.00'),
        },
      ],
    });

    const result: any = await approve();

    expect(result.status).toBe(RAB_STATUS.APPROVED);
  });

  it('a banded matrix cannot be satisfied by a RAB with no final total', async () => {
    arrange({
      rab: lockedRab({ totalFinalCost: null }),
      matrixRows: [
        {
          requiredPositionId: positionId,
          minValue: new Prisma.Decimal('0'),
          maxValue: new Prisma.Decimal('900000000.00'),
        },
      ],
    });

    const result: any = await approve();

    expect(result).toMatchObject({
      reason: RAB_APPROVAL_REASON.RAB_TOTAL_UNKNOWN,
    });
  });

  // ── M. ORGANIZATION GENERICITY ───────────────────────────────────────────
  //
  // THE SAME platform mechanism, four different organizations. Nothing is
  // configured in product code: each case differs only in which Position the
  // existing authority chain reports as the holder.
  describe('M: the same mechanism serves any organization Position', () => {
    it.each([
      ['PUPR', 'PPK'],
      ['perusahaan', 'DIREKTUR'],
      ['perorangan', 'OWNER'],
      ['panitia', 'KETUA'],
    ])('%s configures Position %s as the RAB approver', async (_org, code) => {
      arrange({ holderPositionId: `position-${code}`, holderPositionCode: code });

      const result: any = await approve();

      expect(result.status).toBe(RAB_STATUS.APPROVED);
      expect(result.approvedByPositionCode).toBe(code);
      expect(
        tx.projectBaseline.create.mock.calls[0][0].data.approvedByPositionId,
      ).toBe(`position-${code}`);
    });

    it('the production source hard-codes no organizational role', () => {
      const sources = [
        'rab-approval.service.ts',
        'rab-approval.contracts.ts',
      ].map((file) => readFileSync(join(__dirname, file), 'utf8'));

      for (const source of sources) {
        // Only string literals are searched: the prose above deliberately
        // NAMES these roles as examples, and naming them in a comment is the
        // opposite of branching on them.
        const literals = source.match(/'[A-Z_]+'/g) ?? [];
        expect(literals).not.toContain("'PPK'");
        expect(literals).not.toContain("'DIREKTUR'");
        expect(literals).not.toContain("'DIRECTOR'");
        expect(literals).not.toContain("'OWNER'");
        expect(literals).not.toContain("'KETUA'");
        expect(literals).not.toContain("'CHAIR'");
      }
    });
  });

  // ── THE READ-ONLY DOOR ───────────────────────────────────────────────────
  describe('describeApprovalGate', () => {
    const gate = (permissions: string[] = [PERMISSIONS.RAB_APPROVE]) =>
      service.describeApprovalGate(
        projectId,
        projectAccess(),
        actorAccountId,
        permissions,
      );

    const configured = () => {
      prisma.positionAuthority.findMany.mockResolvedValue([
        { position: { id: positionId, code: 'PPK', name: 'Pejabat Pembuat Komitmen' } },
      ]);
      authority.resolve.mockResolvedValue({
        positionId,
        positionCode: 'PPK',
        authorityCode: RAB_APPROVAL_AUTHORITY,
      });
      prisma.rabDocument.findFirst.mockResolvedValue({
        id: rabId,
        status: RAB_STATUS.LOCKED,
      });
    };

    it('opens the door for the configured holder of a LOCKED RAB', async () => {
      configured();
      const result = await gate();
      expect(result).toMatchObject({
        canApprove: true,
        blocker: null,
        rabStatus: RAB_STATUS.LOCKED,
        holderPositionId: positionId,
      });
    });

    it('reports a GOVERNANCE blocker — not a permission error — when no Position holds the authority', async () => {
      authority.resolve.mockResolvedValue(null);
      prisma.positionAuthority.findMany.mockResolvedValue([]);
      prisma.rabDocument.findFirst.mockResolvedValue({
        id: rabId,
        status: RAB_STATUS.LOCKED,
      });

      const result = await gate([]);

      expect(result).toMatchObject({
        canApprove: false,
        blocker: RAB_APPROVAL_GATE_BLOCKER.NO_CONFIGURED_AUTHORITY,
      });
      expect(result.authorizedPositions).toEqual([]);
    });

    it('names the Positions that may approve when the reader is not the holder', async () => {
      configured();
      authority.resolve.mockResolvedValue(null);

      const result = await gate();

      expect(result).toMatchObject({
        canApprove: false,
        blocker: RAB_APPROVAL_GATE_BLOCKER.ACTOR_IS_NOT_HOLDER,
        holderPositionId: null,
      });
      // The reader is told WHO may act, from existing governance — and is
      // never asked to pick one.
      expect(result.authorizedPositions).toEqual([
        { id: positionId, code: 'PPK', name: 'Pejabat Pembuat Komitmen' },
      ]);
    });

    it('closes the door for a holder who lacks the RAB_APPROVE permission', async () => {
      configured();
      const result = await gate([PERMISSIONS.RAB_VIEW]);
      expect(result).toMatchObject({
        canApprove: false,
        blocker: RAB_APPROVAL_GATE_BLOCKER.PERMISSION_REQUIRED,
      });
    });

    it('closes the door once a baseline is already active', async () => {
      configured();
      prisma.projectBaseline.count.mockResolvedValue(1);
      const result = await gate();
      expect(result).toMatchObject({
        canApprove: false,
        blocker: RAB_APPROVAL_REASON.ACTIVE_BASELINE_EXISTS,
        activeBaselineCount: 1,
      });
    });

    it('closes the door on a RAB that is still DRAFT', async () => {
      configured();
      prisma.rabDocument.findFirst.mockResolvedValue({
        id: rabId,
        status: RAB_STATUS.DRAFT,
      });
      const result = await gate();
      expect(result).toMatchObject({
        canApprove: false,
        blocker: RAB_APPROVAL_REASON.RAB_NOT_LOCKED,
      });
    });

    it('never authorizes anything by itself — it performs no write', async () => {
      configured();
      await gate();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(authority.requireWithinTransaction).not.toHaveBeenCalled();
    });
  });
});

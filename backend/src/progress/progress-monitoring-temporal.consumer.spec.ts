import {
  Prisma,
  ProgressActualStatus,
  ProgressAuditOutcome,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressAuthorityService } from './progress-authority.service';
import { ProgressService } from './progress.service';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import {
  createProgressSemanticVerificationContext,
  MON04_SEMANTIC_AUDIT_ACTION,
  progressSemanticProofMetadata,
  type ProgressSemanticContextScope,
} from './progress-semantic-authority.policy';
import type { Law1CalculationEntry } from './progress-current-official-quantity.policy';
import { PROGRESS_AUTHORITIES } from './progress-authority.service';

describe('MON-04 Monitoring single-cutoff temporal consumer', () => {
  const projectId = 'project-temporal';
  const baselineId = 'baseline-temporal';

  const workItem = (id: string, sortOrder: number) => ({
    id,
    parentId: null,
    wbsNodeId: null,
    wbsCode: `WBS-${sortOrder}`,
    name: `Work item ${sortOrder}`,
    itemType: 'WORK_ITEM',
    sortOrder,
    quantity: new Prisma.Decimal(10),
    unit: 'm3',
    unitPrice: new Prisma.Decimal(10),
    lineTotal: new Prisma.Decimal(100),
    priceOrigin: 'MANUAL_CLIENT',
  });

  const entry = (
    id: string,
    boqItemId: string,
    quantity: string,
    workDate: string,
  ): Law1CalculationEntry & {
    boqItemId: string;
    createdAt: Date;
    photoUrl: null;
  } => ({
    id,
    boqItemId,
    installedQuantity: new Prisma.Decimal(quantity),
    workDate: new Date(`${workDate}T00:00:00.000Z`),
    notes: null,
    photoUrl: null,
    evidenceReferences: [],
    captureMethod: 'FIELD_MEASUREMENT',
    status: ProgressActualStatus.VERIFIED,
    recordedByAccountId: 'actor-record',
    supersedesEntryId: null,
    correctionReasonCode: null,
    correctionReason: null,
    revision: 1,
    createdAt: new Date(`${workDate}T12:00:00.000Z`),
    auditEvents: [],
  });

  const prove = (
    scope: ProgressSemanticContextScope,
    entries: readonly ReturnType<typeof entry>[],
  ): ReturnType<typeof entry>[] => {
    const context = createProgressSemanticVerificationContext(scope, entries);
    if (context.state !== 'VALID') throw new Error('VALID_CONTEXT_REQUIRED');
    const metadata = progressSemanticProofMetadata(context);

    return entries.map((candidate) => ({
      ...candidate,
      auditEvents: [
        {
          action: MON04_SEMANTIC_AUDIT_ACTION,
          outcome: ProgressAuditOutcome.SUCCESS,
          occurredAt: new Date('2026-09-15T12:00:00.000Z'),
          actorAccountId: 'actor-verify',
          authorityCode: PROGRESS_AUTHORITIES.VERIFY,
          metadata,
          actor: { displayName: 'Verifier' },
        },
      ],
    }));
  };

  const readClient = (
    items: ReturnType<typeof workItem>[],
    entries: ReturnType<typeof entry>[],
  ) => ({
    project: {
      findUnique: jest.fn().mockResolvedValue({ timeZone: 'Asia/Makassar' }),
    },
    projectBaseline: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: baselineId,
          versionNumber: 3,
          approvedAt: new Date('2026-09-01T00:00:00.000Z'),
          rabDocument: {
            boqStructureId: 'boq-structure-temporal',
            totalBaseCost: new Prisma.Decimal(items.length * 100),
          },
        },
      ]),
    },
    boqItem: { findMany: jest.fn().mockResolvedValue(items) },
    progressEntry: { findMany: jest.fn().mockResolvedValue(entries) },
  });

  const serviceFor = (directClient: ReturnType<typeof readClient>) => {
    const transactionClient = directClient;
    const prisma = {
      ...directClient,
      $transaction: jest.fn(
        async (
          operation: (tx: typeof transactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) => operation(transactionClient),
      ),
    };
    const service = new ProgressService(
      prisma as unknown as PrismaService,
      {} as ProgressAuthorityService,
      {} as WorkspacePermissionResolverService,
    );

    return { service, prisma, transactionClient };
  };

  it('keeps the existing no-cutoff response free of temporal fields and transactions', async () => {
    const item = workItem('item-current-only', 1);
    const client = readClient([item], []);
    const { service, prisma } = serviceFor(client);

    const result = await service.getMonitoring(projectId);

    expect(result).not.toHaveProperty('actualTemporal');
    expect(result.items[0]).toMatchObject({
      id: item.id,
      currentOfficialQuantity: { state: 'NOT_YET_RECORDED' },
      currentOfficialItemProgress: { state: 'NOT_YET_RECORDED' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(client.project.findUnique).toHaveBeenCalledTimes(1);
    expect(client.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(client.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(client.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps Current=7 while exposing cutoff 07 Sep=3 from the same bounded read', async () => {
    const item = workItem('item-cutoff', 1);
    const scope = {
      projectId,
      activeBaselineId: baselineId,
      boqItemId: item.id,
    };
    const entries = prove(scope, [
      entry('entry-sep-05', item.id, '3', '2026-09-05'),
      entry('entry-sep-09', item.id, '4', '2026-09-09'),
    ]);
    const client = readClient([item], entries);
    const { service, prisma } = serviceFor(client);

    const result = await service.getMonitoring(projectId, '2026-09-07');

    expect(result.items[0]).toMatchObject({
      currentOfficialQuantity: {
        state: 'COMPLETE',
        currentOfficialQuantity: '7',
      },
      currentOfficialItemProgress: {
        state: 'COMPLETE',
        rawPhysicalProgressPercent: '70',
        boundedContributionProgressPercent: '70',
      },
    });
    expect(result.actualTemporal).toEqual({
      mode: 'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE',
      cutoffDate: '2026-09-07',
      baseline: {
        id: baselineId,
        versionNumber: 3,
        approvedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      items: [
        {
          boqItemId: item.id,
          officialQuantity: {
            state: 'COMPLETE',
            currentOfficialQuantity: '3',
          },
          officialPhysicalProgress: {
            state: 'COMPLETE',
            rawPhysicalProgressPercent: '30',
            boundedContributionProgressPercent: '30',
          },
        },
      ],
      officialRabWeightedPhysicalProgress: {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: '30',
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(client.project.findUnique).toHaveBeenCalledTimes(1);
    expect(client.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(client.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(client.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps read-query count bounded as WORK_ITEM count increases', async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      workItem(`bounded-item-${index + 1}`, index + 1),
    );
    const entries = items.flatMap((item, index) =>
      prove({ projectId, activeBaselineId: baselineId, boqItemId: item.id }, [
        entry(`bounded-entry-${index + 1}`, item.id, '1', '2026-09-07'),
      ]),
    );
    const client = readClient(items, entries);
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(projectId, '2026-09-07');

    expect(result.actualTemporal.items).toHaveLength(25);
    expect(client.project.findUnique).toHaveBeenCalledTimes(1);
    expect(client.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(client.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(client.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid calendar date', '2026-09-31'],
    ['canonical year edge', '0099-01-01'],
    ['timestamp', '2026-09-07T00:00:00.000Z'],
    ['duplicate query values', ['2026-09-07', '2026-09-08']],
    ['object query value', { value: '2026-09-07' }],
  ])(
    'rejects %s instead of falling back to Current',
    async (_label, cutoffDate) => {
      const client = readClient([], []);
      const { service, prisma } = serviceFor(client);

      await expect(
        service.getMonitoring(projectId, cutoffDate),
      ).rejects.toEqual(
        new BadRequestException('INVALID_PROJECT_BUSINESS_CUTOFF'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(client.project.findUnique).not.toHaveBeenCalled();
    },
  );
});

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
    provenEntryIds = entries.map((candidate) => candidate.id),
  ): ReturnType<typeof entry>[] => {
    const context = createProgressSemanticVerificationContext(scope, entries);
    if (context.state !== 'VALID') throw new Error('VALID_CONTEXT_REQUIRED');
    const metadata = progressSemanticProofMetadata(context);
    const proven = new Set(provenEntryIds);

    return entries.map((candidate) =>
      proven.has(candidate.id)
        ? {
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
          }
        : candidate,
    );
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
            totalBaseCost: items.reduce(
              (sum, item) => sum.plus(item.lineTotal),
              new Prisma.Decimal(0),
            ),
          },
        },
      ]),
    },
    boqItem: { findMany: jest.fn().mockResolvedValue(items) },
    progressEntry: { findMany: jest.fn().mockResolvedValue(entries) },
  });

  const serviceFor = (
    directClient: ReturnType<typeof readClient>,
    distinguishTransactionClient = false,
  ) => {
    const transactionClient = directClient;
    const rootClient = distinguishTransactionClient
      ? {
          project: {
            findUnique: jest
              .fn()
              .mockRejectedValue(new Error('ROOT_PROJECT_READ_FORBIDDEN')),
          },
          projectBaseline: {
            findMany: jest
              .fn()
              .mockRejectedValue(new Error('ROOT_BASELINE_READ_FORBIDDEN')),
          },
          boqItem: {
            findMany: jest
              .fn()
              .mockRejectedValue(new Error('ROOT_BOQ_READ_FORBIDDEN')),
          },
          progressEntry: {
            findMany: jest
              .fn()
              .mockRejectedValue(new Error('ROOT_PROGRESS_READ_FORBIDDEN')),
          },
        }
      : directClient;
    const prisma = {
      ...rootClient,
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

    return { service, prisma, rootClient, transactionClient };
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

    const result = await service.getMonitoring(projectId, '2026-09-07', true);

    expect(result.actualTemporal.items).toHaveLength(25);
    expect(result.actualTemporal.series.points).toHaveLength(1);
    expect(client.project.findUnique).toHaveBeenCalledTimes(1);
    expect(client.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(client.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(client.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('adds the exact 12, 24, 40, 40 project series while preserving Current and single-cutoff truth', async () => {
    const itemA = {
      ...workItem('series-item-a', 1),
      unitPrice: new Prisma.Decimal(4),
      lineTotal: new Prisma.Decimal(40),
    };
    const itemB = {
      ...workItem('series-item-b', 2),
      unitPrice: new Prisma.Decimal(6),
      lineTotal: new Prisma.Decimal(60),
    };
    const entries = [
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: itemA.id,
        },
        [
          entry('series-a-sep-05', itemA.id, '3', '2026-09-05'),
          entry('series-a-sep-09', itemA.id, '4', '2026-09-09'),
        ],
      ),
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: itemB.id,
        },
        [entry('series-b-sep-07', itemB.id, '2', '2026-09-07')],
      ),
    ];
    const client = readClient([itemA, itemB], entries);
    const { service, prisma, rootClient, transactionClient } = serviceFor(
      client,
      true,
    );

    const result = await service.getMonitoring(projectId, '2026-09-10', true);

    expect(result.currentOfficialRabWeightedPhysicalProgress).toEqual({
      state: 'COMPLETE',
      currentOfficialRabWeightedPhysicalProgressPercent: '40',
    });
    expect(result.actualTemporal.officialRabWeightedPhysicalProgress).toEqual({
      state: 'COMPLETE',
      currentOfficialRabWeightedPhysicalProgressPercent: '40',
    });
    expect(result.actualTemporal.series).toEqual({
      boundaryBasis: 'CURRENT_GOVERNED_WORKDATES_AND_REQUESTED_CUTOFF',
      points: [
        {
          cutoffDate: '2026-09-05',
          officialRabWeightedPhysicalProgress: {
            state: 'COMPLETE',
            currentOfficialRabWeightedPhysicalProgressPercent: '12',
          },
        },
        {
          cutoffDate: '2026-09-07',
          officialRabWeightedPhysicalProgress: {
            state: 'COMPLETE',
            currentOfficialRabWeightedPhysicalProgressPercent: '24',
          },
        },
        {
          cutoffDate: '2026-09-09',
          officialRabWeightedPhysicalProgress: {
            state: 'COMPLETE',
            currentOfficialRabWeightedPhysicalProgressPercent: '40',
          },
        },
        {
          cutoffDate: '2026-09-10',
          officialRabWeightedPhysicalProgress: {
            state: 'COMPLETE',
            currentOfficialRabWeightedPhysicalProgressPercent: '40',
          },
        },
      ],
    });
    expect(
      result.actualTemporal.series.points.at(-1)
        ?.officialRabWeightedPhysicalProgress,
    ).toEqual(result.actualTemporal.officialRabWeightedPhysicalProgress);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(rootClient.project.findUnique).not.toHaveBeenCalled();
    expect(rootClient.projectBaseline.findMany).not.toHaveBeenCalled();
    expect(rootClient.boqItem.findMany).not.toHaveBeenCalled();
    expect(rootClient.progressEntry.findMany).not.toHaveBeenCalled();
    expect(transactionClient.project.findUnique).toHaveBeenCalledTimes(1);
    expect(transactionClient.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(transactionClient.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(transactionClient.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('stops the requested series at 07 Sep without overwriting Current=40', async () => {
    const itemA = {
      ...workItem('short-item-a', 1),
      lineTotal: new Prisma.Decimal(40),
    };
    const itemB = {
      ...workItem('short-item-b', 2),
      lineTotal: new Prisma.Decimal(60),
    };
    const entries = [
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: itemA.id,
        },
        [
          entry('short-a-sep-05', itemA.id, '3', '2026-09-05'),
          entry('short-a-sep-09', itemA.id, '4', '2026-09-09'),
        ],
      ),
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: itemB.id,
        },
        [entry('short-b-sep-07', itemB.id, '2', '2026-09-07')],
      ),
    ];
    const { service } = serviceFor(readClient([itemA, itemB], entries));

    const result = await service.getMonitoring(projectId, '2026-09-07', true);

    expect(result.currentOfficialRabWeightedPhysicalProgress).toMatchObject({
      state: 'COMPLETE',
      currentOfficialRabWeightedPhysicalProgressPercent: '40',
    });
    expect(result.actualTemporal.series.points).toEqual([
      {
        cutoffDate: '2026-09-05',
        officialRabWeightedPhysicalProgress: {
          state: 'COMPLETE',
          currentOfficialRabWeightedPhysicalProgressPercent: '12',
        },
      },
      {
        cutoffDate: '2026-09-07',
        officialRabWeightedPhysicalProgress: {
          state: 'COMPLETE',
          currentOfficialRabWeightedPhysicalProgressPercent: '24',
        },
      },
    ]);
    expect(
      result.actualTemporal.series.points.at(-1)
        ?.officialRabWeightedPhysicalProgress,
    ).toEqual(result.actualTemporal.officialRabWeightedPhysicalProgress);
  });

  it('moves correction boundaries and values without retaining its superseded predecessor date', async () => {
    const itemA = {
      ...workItem('corrected-item-a', 1),
      lineTotal: new Prisma.Decimal(40),
    };
    const itemB = {
      ...workItem('corrected-item-b', 2),
      lineTotal: new Prisma.Decimal(60),
    };
    const itemAEntries = prove(
      {
        projectId,
        activeBaselineId: baselineId,
        boqItemId: itemA.id,
      },
      [
        entry('corrected-predecessor', itemA.id, '3', '2026-09-05'),
        {
          ...entry('corrected-successor', itemA.id, '2', '2026-09-08'),
          supersedesEntryId: 'corrected-predecessor',
          revision: 2,
        },
        entry('corrected-a-sep-09', itemA.id, '4', '2026-09-09'),
      ],
    );
    const itemBEntries = prove(
      {
        projectId,
        activeBaselineId: baselineId,
        boqItemId: itemB.id,
      },
      [entry('corrected-b-sep-07', itemB.id, '2', '2026-09-07')],
    );
    const entries = [...itemAEntries, ...itemBEntries];
    const forward = serviceFor(readClient([itemA, itemB], entries)).service;
    const reversed = serviceFor(
      readClient([itemA, itemB], [...entries].reverse()),
    ).service;

    const forwardResult = await forward.getMonitoring(
      projectId,
      '2026-09-10',
      true,
    );
    const reversedResult = await reversed.getMonitoring(
      projectId,
      '2026-09-10',
      true,
    );
    const expected = [
      ['2026-09-07', '12'],
      ['2026-09-08', '20'],
      ['2026-09-09', '36'],
      ['2026-09-10', '36'],
    ];
    const compact = forwardResult.actualTemporal.series.points.map((point) => [
      point.cutoffDate,
      point.officialRabWeightedPhysicalProgress
        .currentOfficialRabWeightedPhysicalProgressPercent,
    ]);

    expect(compact).toEqual(expected);
    expect(compact.map(([date]) => date)).not.toContain('2026-09-05');
    expect(reversedResult.actualTemporal.series).toEqual(
      forwardResult.actualTemporal.series,
    );
  });

  it('propagates INCOMPLETE known subtotal state to every applicable point', async () => {
    const completeItem = {
      ...workItem('series-complete-known', 1),
      lineTotal: new Prisma.Decimal(50),
    };
    const incompleteItem = {
      ...workItem('series-incomplete', 2),
      lineTotal: new Prisma.Decimal(50),
    };
    const eligible = entry(
      'series-incomplete-known',
      incompleteItem.id,
      '3',
      '2026-09-05',
    );
    const submitted = {
      ...entry(
        'series-incomplete-submitted',
        incompleteItem.id,
        '4',
        '2026-09-06',
      ),
      status: ProgressActualStatus.SUBMITTED,
    };
    const entries = [
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: completeItem.id,
        },
        [
          entry(
            'series-complete-known-entry',
            completeItem.id,
            '2',
            '2026-09-05',
          ),
        ],
      ),
      ...prove(
        {
          projectId,
          activeBaselineId: baselineId,
          boqItemId: incompleteItem.id,
        },
        [eligible, submitted],
        [eligible.id],
      ),
    ];
    const { service } = serviceFor(
      readClient([completeItem, incompleteItem], entries),
    );

    const result = await service.getMonitoring(projectId, '2026-09-07', true);

    expect(result.actualTemporal.series.points).toEqual([
      {
        cutoffDate: '2026-09-05',
        officialRabWeightedPhysicalProgress: {
          state: 'INCOMPLETE',
          knownWeightedContributionSubtotalPercent: '10',
        },
      },
      {
        cutoffDate: '2026-09-07',
        officialRabWeightedPhysicalProgress: {
          state: 'INCOMPLETE',
          knownWeightedContributionSubtotalPercent: '10',
        },
      },
    ]);
    expect(
      result.actualTemporal.series.points.at(-1)
        ?.officialRabWeightedPhysicalProgress,
    ).toEqual(result.actualTemporal.officialRabWeightedPhysicalProgress);
  });

  it('treats includeActualSeries=false as the existing single-cutoff path', async () => {
    const item = workItem('series-false', 1);
    const client = readClient([item], []);
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(projectId, '2026-09-07', false);

    expect(result.actualTemporal).not.toHaveProperty('series');
    expect(client.project.findUnique).toHaveBeenCalledTimes(1);
    expect(client.projectBaseline.findMany).toHaveBeenCalledTimes(1);
    expect(client.boqItem.findMany).toHaveBeenCalledTimes(1);
    expect(client.progressEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps a no-Actual series to the requested cutoff without fabricating COMPLETE zero', async () => {
    const item = workItem('series-no-actual', 1);
    const { service } = serviceFor(readClient([item], []));

    const result = await service.getMonitoring(projectId, '2026-09-07', true);

    expect(result.actualTemporal.series.points).toEqual([
      {
        cutoffDate: '2026-09-07',
        officialRabWeightedPhysicalProgress: {
          state: 'INCOMPLETE',
          knownWeightedContributionSubtotalPercent: '0',
        },
      },
    ]);
    expect(
      result.actualTemporal.series.points[0]
        .officialRabWeightedPhysicalProgress,
    ).toEqual(result.actualTemporal.officialRabWeightedPhysicalProgress);
  });

  it('returns one canonical unavailable cutoff point when no Active Baseline exists', async () => {
    const client = readClient([], []);
    client.projectBaseline.findMany.mockResolvedValue([]);
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(projectId, '2026-09-07', true);

    expect(result.actualTemporal.series).toEqual({
      boundaryBasis: 'CURRENT_GOVERNED_WORKDATES_AND_REQUESTED_CUTOFF',
      points: [
        {
          cutoffDate: '2026-09-07',
          officialRabWeightedPhysicalProgress: {
            state: 'UNAVAILABLE',
            reason: 'BASELINE_VALUE_UNAVAILABLE',
          },
        },
      ],
    });
    expect(client.boqItem.findMany).not.toHaveBeenCalled();
    expect(client.progressEntry.findMany).not.toHaveBeenCalled();
  });

  it('rejects a series request without a cutoff before opening a transaction', async () => {
    const client = readClient([], []);
    const { service, prisma } = serviceFor(client);

    await expect(
      service.getMonitoring(projectId, undefined, true),
    ).rejects.toEqual(new BadRequestException('ACTUAL_SERIES_REQUIRES_CUTOFF'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(client.project.findUnique).not.toHaveBeenCalled();
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

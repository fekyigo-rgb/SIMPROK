import { ExecutionPlanStatus, Prisma, ProjectStatus } from '@prisma/client';
import { EXECUTION_PLAN_AUTHORITY } from './execution-plan.contracts';
import { ExecutionPlanService } from './execution-plan.service';

describe('SR-01 Execution Plan lifecycle semantics', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '10000000-0000-4000-8000-000000000002';
  const baselineId = '10000000-0000-4000-8000-000000000003';
  const planId = '10000000-0000-4000-8000-000000000004';
  const boqItemId = '10000000-0000-4000-8000-000000000005';
  const accountId = '10000000-0000-4000-8000-000000000006';
  const positionId = '10000000-0000-4000-8000-000000000007';
  const actor = {
    accountId,
    projectAccess: {
      projectId,
      workspaceId,
      projectStatus: ProjectStatus.PLANNED,
      membershipId: '10000000-0000-4000-8000-000000000008',
      assignmentId: '10000000-0000-4000-8000-000000000009',
      roleInProject: 'PLANNER',
      isPrimaryAssignment: true,
      roles: ['PLANNER'],
    },
  };

  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  function harness(options?: {
    projectStatus?: ProjectStatus;
    planStatus?: ExecutionPlanStatus;
    lockedFromProjectStatus?: ProjectStatus | null;
    otherBaselinePlanCount?: number;
  }) {
    const projectStatus = options?.projectStatus ?? ProjectStatus.PLANNED;
    const plan: any = {
      id: planId,
      projectId,
      baselineId,
      versionNumber: 1,
      revision: 2,
      status: options?.planStatus ?? ExecutionPlanStatus.DRAFT,
      predecessorId: null,
      createdByAccountId: accountId,
      lastEditedByAccountId: accountId,
      lastEditedAt: new Date('2026-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      lockedAt:
        options?.planStatus === ExecutionPlanStatus.LOCKED
          ? new Date('2026-09-02T00:00:00.000Z')
          : null,
      lockedByAccountId:
        options?.planStatus === ExecutionPlanStatus.LOCKED ? accountId : null,
      lockedByPositionId:
        options?.planStatus === ExecutionPlanStatus.LOCKED ? positionId : null,
      lockedFromRevision:
        options?.planStatus === ExecutionPlanStatus.LOCKED ? 2 : null,
      lockedFromProjectStatus:
        options?.planStatus === ExecutionPlanStatus.LOCKED
          ? (options.lockedFromProjectStatus ?? projectStatus)
          : null,
      lockedAuthorityCode:
        options?.planStatus === ExecutionPlanStatus.LOCKED
          ? EXECUTION_PLAN_AUTHORITY
          : null,
      distributions: [
        {
          id: 'distribution-1',
          executionPlanVersionId: planId,
          boqItemId,
          periodStartDate: day('2026-09-01'),
          periodEndDate: day('2026-09-07'),
          plannedIncrementalQuantity: new Prisma.Decimal(10),
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    };
    const baseline = {
      id: baselineId,
      projectId,
      versionNumber: 1,
      approvedAt: new Date('2026-08-31T00:00:00.000Z'),
      rabDocument: {
        boqStructureId: 'structure-1',
        totalBaseCost: new Prisma.Decimal(100),
      },
    };
    const items = [
      {
        id: boqItemId,
        parentId: null,
        wbsNodeId: null,
        wbsCode: '1',
        name: 'Work Item',
        itemType: 'WORK_ITEM',
        sortOrder: 1,
        quantity: new Prisma.Decimal(10),
        unit: 'm3',
        lineTotal: new Prisma.Decimal(100),
      },
    ];
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: projectId,
          workspaceId,
          status: projectStatus,
          startDate: null,
        },
      ]),
      projectBaseline: { findMany: jest.fn().mockResolvedValue([baseline]) },
      boqItem: { findMany: jest.fn().mockResolvedValue(items) },
      executionPlanVersion: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve([plan])),
        count: jest
          .fn()
          .mockResolvedValue(options?.otherBaselinePlanCount ?? 0),
        updateMany: jest.fn().mockImplementation(({ data }) => {
          if (plan.status !== ExecutionPlanStatus.DRAFT) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(plan, data);
          return Promise.resolve({ count: 1 });
        }),
      },
      executionPlanDistribution: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      progressAuditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(tx)),
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: projectId,
          workspaceId,
          status: projectStatus,
          timeZone: 'UTC',
        }),
      },
      projectBaseline: tx.projectBaseline,
      boqItem: tx.boqItem,
      executionPlanVersion: {
        findMany: tx.executionPlanVersion.findMany,
        count: tx.executionPlanVersion.count,
      },
    };
    const authority: any = {
      requireWithinTransaction: jest.fn().mockResolvedValue({
        positionId,
        positionCode: 'PROJECT_GOVERNOR',
        authorityCode: EXECUTION_PLAN_AUTHORITY,
      }),
      requireActiveActor: jest.fn().mockResolvedValue({
        roleInProject: 'PLANNER',
      }),
      resolve: jest.fn().mockResolvedValue({
        positionId,
        positionCode: 'PROJECT_GOVERNOR',
        authorityCode: EXECUTION_PLAN_AUTHORITY,
      }),
    };
    return {
      tx,
      plan,
      prisma,
      service: new ExecutionPlanService(prisma, authority),
    };
  }

  it('locks a DRAFT plan while leaving a PLANNED project unchanged', async () => {
    const candidate = harness();
    await expect(
      candidate.service.lock(
        projectId,
        { executionPlanVersionId: planId, expectedRevision: 2 },
        actor,
      ),
    ).resolves.toMatchObject({
      changed: true,
      status: ExecutionPlanStatus.LOCKED,
      projectStatus: ProjectStatus.PLANNED,
      lockedFromProjectStatus: ProjectStatus.PLANNED,
    });
    expect(candidate.tx).not.toHaveProperty('project');
  });

  it('replays the exact lock idempotently while Project remains PLANNED without rewriting provenance', async () => {
    const candidate = harness();
    await candidate.service.lock(
      projectId,
      { executionPlanVersionId: planId, expectedRevision: 2 },
      actor,
    );
    const provenance = {
      lockedAt: candidate.plan.lockedAt,
      lockedByAccountId: candidate.plan.lockedByAccountId,
      lockedByPositionId: candidate.plan.lockedByPositionId,
      lockedFromRevision: candidate.plan.lockedFromRevision,
      lockedFromProjectStatus: candidate.plan.lockedFromProjectStatus,
      lockedAuthorityCode: candidate.plan.lockedAuthorityCode,
    };

    await expect(
      candidate.service.lock(
        projectId,
        { executionPlanVersionId: planId, expectedRevision: 2 },
        actor,
      ),
    ).resolves.toMatchObject({
      changed: false,
      projectStatus: ProjectStatus.PLANNED,
    });
    expect(candidate.plan).toMatchObject(provenance);
    expect(candidate.tx.executionPlanVersion.updateMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('preserves exact replay for a legacy ACTIVE project with a whole locked plan', async () => {
    const candidate = harness({
      projectStatus: ProjectStatus.ACTIVE,
      planStatus: ExecutionPlanStatus.LOCKED,
      lockedFromProjectStatus: ProjectStatus.ACTIVE,
    });
    await expect(
      candidate.service.lock(
        projectId,
        { executionPlanVersionId: planId, expectedRevision: 2 },
        {
          ...actor,
          projectAccess: {
            ...actor.projectAccess,
            projectStatus: ProjectStatus.ACTIVE,
          },
        },
      ),
    ).resolves.toMatchObject({
      changed: false,
      projectStatus: ProjectStatus.ACTIVE,
      lockedFromProjectStatus: ProjectStatus.ACTIVE,
    });
  });

  it('reads PLANNED plus LOCKED as healthy plan readiness, not execution eligibility', async () => {
    const candidate = harness({
      planStatus: ExecutionPlanStatus.LOCKED,
      lockedFromProjectStatus: ProjectStatus.PLANNED,
    });
    const result = await candidate.service.getForMonitoring({
      projectId,
      accountId,
      projectAccess: actor.projectAccess,
      effectivePermissions: ['PROJECT_VIEW'],
    });
    expect(result).toMatchObject({
      projectStatus: ProjectStatus.PLANNED,
      readinessState: 'LOCKED_FOR_EXECUTION',
      plan: { status: ExecutionPlanStatus.LOCKED },
      blockers: [],
    });
  });

  it('keeps ordinary draft writes forbidden after LOCK', async () => {
    const candidate = harness({
      planStatus: ExecutionPlanStatus.LOCKED,
      lockedFromProjectStatus: ProjectStatus.PLANNED,
    });
    await expect(
      candidate.service.saveDraft(
        projectId,
        { expectedRevision: 2, distributions: [] },
        actor,
      ),
    ).rejects.toMatchObject({ message: 'EXECUTION_PLAN_ALREADY_LOCKED' });
  });

  it('keeps cross-baseline plan context fail-closed', async () => {
    const candidate = harness({ otherBaselinePlanCount: 1 });
    await expect(
      candidate.service.lock(
        projectId,
        { executionPlanVersionId: planId, expectedRevision: 2 },
        actor,
      ),
    ).rejects.toMatchObject({ message: 'BASELINE_BINDING_MISMATCH' });
    expect(candidate.plan.status).toBe(ExecutionPlanStatus.DRAFT);
  });
});

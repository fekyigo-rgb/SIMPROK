import { ExecutionPlanStatus, Prisma, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressAuthorityService } from './progress-authority.service';
import { ProgressService } from './progress.service';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';

/**
 * PERIOD NAVIGATOR — service wiring, with ON_HOLD as the subject.
 *
 * Monitoring's canonical Planned Curve is ACTIVE-specific: for an ON_HOLD
 * project it is deliberately UNAVAILABLE (LOCKED_PLAN_PROJECT_NOT_ACTIVE) even
 * though the LOCKED plan itself is perfectly authoritative. The navigator must
 * therefore take the Calendar horizon start from the authoritative plan
 * IDENTITY and its distributions — never from the curve — or ON_HOLD projects
 * would silently lose their reporting periods.
 *
 * These tests drive the real ProgressService against a fake read client, so the
 * wiring itself is under test, not a restatement of the pure policy.
 */
describe('MON-04 Period Navigator service wiring', () => {
  const projectId = 'project-navigator';
  const baselineId = 'baseline-navigator';
  const otherBaselineId = 'baseline-other';

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

  const lockedPlan = (
    id: string,
    versionNumber: number,
    planBaselineId: string,
    firstStart: string,
  ) => ({
    id,
    versionNumber,
    baselineId: planBaselineId,
    status: ExecutionPlanStatus.LOCKED,
    distributions: [
      {
        id: `${id}-dist-1`,
        boqItemId: 'item-1',
        periodStartDate: new Date(`${firstStart}T00:00:00.000Z`),
        periodEndDate: new Date('2026-08-31T00:00:00.000Z'),
        plannedIncrementalQuantity: new Prisma.Decimal(10),
      },
    ],
  });

  const readClient = (options: {
    status: ProjectStatus;
    plans: ReturnType<typeof lockedPlan>[];
    items?: ReturnType<typeof workItem>[];
  }) => {
    const items = options.items ?? [workItem('item-1', 1)];
    return {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          status: options.status,
          timeZone: 'Asia/Jakarta',
          startDate: null,
        }),
      },
      projectBaseline: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: baselineId,
            versionNumber: 1,
            approvedAt: new Date('2026-07-01T00:00:00.000Z'),
            rabDocument: {
              boqStructureId: 'boq-structure-navigator',
              totalBaseCost: items.reduce(
                (sum, item) => sum.plus(item.lineTotal),
                new Prisma.Decimal(0),
              ),
            },
          },
        ]),
      },
      boqItem: { findMany: jest.fn().mockResolvedValue(items) },
      progressEntry: { findMany: jest.fn().mockResolvedValue([]) },
      executionPlanVersion: {
        findMany: jest.fn().mockResolvedValue(options.plans),
      },
      // The Work Period Anchor is read through its canonical audit policy; with
      // no governance proof it resolves NOT_PROVEN, which is what we want here.
      progressAuditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
  };

  const serviceFor = (client: ReturnType<typeof readClient>) => {
    const prisma = {
      ...client,
      $transaction: jest.fn(
        async (operation: (tx: typeof client) => Promise<unknown>) =>
          operation(client),
      ),
    };
    const service = new ProgressService(
      prisma as unknown as PrismaService,
      {} as ProgressAuthorityService,
      {} as WorkspacePermissionResolverService,
    );
    return { service, prisma };
  };

  const navigatorOf = (result: unknown) =>
    (
      result as {
        periodNavigator?: {
          mode: string;
          basis: string;
          granularity: string;
          state: string;
          reason?: string;
          periods?: { startDate: string; endDate: string; periodKey: string }[];
          hasMoreOlder?: boolean;
          olderCursor?: string | null;
        };
      }
    ).periodNavigator;

  // ───────────────────────────────────────────────────────────────────────────
  // §9 MANDATORY SCENARIO
  // ───────────────────────────────────────────────────────────────────────────

  it('ON_HOLD with an authoritative LOCKED plan resolves the Calendar horizon from the plan start', async () => {
    const client = readClient({
      status: ProjectStatus.ON_HOLD,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );
    const navigator = navigatorOf(result);

    expect(navigator?.mode).toBe('CANONICAL_MONITORING_PERIOD_NAVIGATOR_V1');
    expect(navigator?.granularity).toBe('WEEK');

    // Calendar resolves from the LOCKED plan's earliest execution start, even
    // though the Planned Curve is UNAVAILABLE for a non-ACTIVE project.
    expect(navigator?.basis).toBe('CALENDAR');
    expect(navigator?.state).toBe('RESOLVED');
    const periods = navigator?.periods ?? [];
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.length).toBeLessThanOrEqual(64);

    // The oldest enumerated week is the ISO week containing 2026-08-03 (a Monday).
    expect(periods[periods.length - 1]).toMatchObject({
      startDate: '2026-08-03',
    });
  });

  it('ACTIVE behaves identically for the same authoritative LOCKED plan', async () => {
    const client = readClient({
      status: ProjectStatus.ACTIVE,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );

    expect(navigatorOf(result)?.state).toBe('RESOLVED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // FAIL-CLOSED CONTROLS
  // ───────────────────────────────────────────────────────────────────────────

  it('ON_HOLD with more than one LOCKED plan candidate fails Calendar closed', async () => {
    const client = readClient({
      status: ProjectStatus.ON_HOLD,
      plans: [
        lockedPlan('plan-2', 2, baselineId, '2026-08-03'),
        lockedPlan('plan-1', 1, baselineId, '2026-08-03'),
      ],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );

    expect(navigatorOf(result)).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT',
    });
  });

  it('ON_HOLD with a plan bound to another Baseline fails Calendar closed', async () => {
    const client = readClient({
      status: ProjectStatus.ON_HOLD,
      plans: [lockedPlan('plan-1', 1, otherBaselineId, '2026-08-03')],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );

    expect(navigatorOf(result)).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'BASELINE_BINDING_MISMATCH',
    });
  });

  it('never falls through to Actual truth once plan truth is broken', async () => {
    // No governed Actual exists here either, but the point is the REASON: a
    // broken plan must not be reported as "no execution date available".
    const client = readClient({
      status: ProjectStatus.ON_HOLD,
      plans: [
        lockedPlan('plan-2', 2, baselineId, '2026-08-03'),
        lockedPlan('plan-1', 1, baselineId, '2026-08-03'),
      ],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );

    expect(navigatorOf(result)?.reason).not.toBe(
      'EARLIEST_AUTHORITATIVE_EXECUTION_DATE_UNAVAILABLE',
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // STATUS + DEFAULT CONTRACT
  // ───────────────────────────────────────────────────────────────────────────

  it.each([
    [ProjectStatus.PLANNED, 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT'],
    [ProjectStatus.COMPLETED, 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
    [ProjectStatus.CANCELLED, 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
    [ProjectStatus.ARCHIVED, 'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED'],
  ])('%s fails both bases closed with an explicit reason', async (status, reason) => {
    const client = readClient({
      status,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'MONTH' },
    );
    const navigator = navigatorOf(result);

    expect(navigator).toMatchObject({ state: 'UNAVAILABLE', reason });
  });

  it('omits periodNavigator entirely and runs no transaction without opt-in', async () => {
    const client = readClient({
      status: ProjectStatus.ACTIVE,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service, prisma } = serviceFor(client);

    const result = await service.getMonitoring(projectId);

    expect(result).not.toHaveProperty('periodNavigator');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // The plan is not even read when nothing needs planned context.
    expect(client.executionPlanVersion.findMany).not.toHaveBeenCalled();
  });

  it('runs the navigator inside the existing RepeatableRead snapshot', async () => {
    const client = readClient({
      status: ProjectStatus.ACTIVE,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service, prisma } = serviceFor(client);

    await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'WEEK' },
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('shares one Project Business Today across both basis lists', async () => {
    const client = readClient({
      status: ProjectStatus.ACTIVE,
      plans: [lockedPlan('plan-1', 1, baselineId, '2026-08-03')],
    });
    const { service } = serviceFor(client);

    const result = await service.getMonitoring(
      projectId,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { basis: 'CALENDAR', granularity: 'MONTH' },
    );
    const navigator = navigatorOf(result);

    // Built from the one captured instant, so the newest Calendar month is the
    // month holding that Today.
    expect(navigator?.state).toBe('RESOLVED');
    const newest = navigator?.periods?.[0];
    expect(newest).toBeDefined();
    expect(newest?.periodKey).toMatch(/^\d{4}-\d{2}$/);
  });
});

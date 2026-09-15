import { Prisma, ProjectStatus } from '@prisma/client';
import { EXECUTION_PLAN_BLOCKER } from './execution-plan.contracts';
import { EXECUTION_PLAN_DRAFT_FLOW } from './execution-plan-adoption.policy';
import {
  projectExecutionPlan,
  type ExecutionPlanProjectionDistribution,
  type ExecutionPlanProjectionItem,
} from './execution-plan-projection.policy';

const item = (
  id: string,
  quantity: string,
  lineTotal: string | null,
  sortOrder: number,
): ExecutionPlanProjectionItem => ({
  id,
  parentId: null,
  wbsNodeId: null,
  wbsCode: id.toUpperCase(),
  name: `Work ${id}`,
  itemType: 'WORK_ITEM',
  sortOrder,
  quantity: new Prisma.Decimal(quantity),
  unit: 'm3',
  lineTotal: lineTotal === null ? null : new Prisma.Decimal(lineTotal),
});

const period = (
  id: string,
  boqItemId: string,
  start: string,
  end: string,
  quantity: string,
): ExecutionPlanProjectionDistribution => ({
  id,
  boqItemId,
  periodStartDate: new Date(`${start}T00:00:00.000Z`),
  periodEndDate: new Date(`${end}T00:00:00.000Z`),
  plannedIncrementalQuantity: new Prisma.Decimal(quantity),
});

describe('MON-04 official planned projection', () => {
  it('derives incremental -> cumulative -> item progress -> H2-A1 project curve exactly', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '10', '60', 0), item('b', '20', '40', 1)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-07', '4'),
        period('a2', 'a', '2026-09-08', '2026-09-14', '6'),
        period('b1', 'b', '2026-09-01', '2026-09-14', '20'),
      ],
    });

    expect(projection.readinessState).toBe('READY_FOR_LOCK');
    expect(projection.blockers).toEqual([]);
    expect(projection.schedule).toEqual([
      expect.objectContaining({
        boqItemId: 'a',
        plannedStartDate: '2026-09-01',
        plannedFinishDate: '2026-09-14',
        plannedQuantity: '10',
        plannedItemProgressPercent: '100',
      }),
      expect.objectContaining({
        boqItemId: 'b',
        plannedQuantity: '20',
        plannedItemProgressPercent: '100',
      }),
    ]);
    expect(projection.plannedCurve).toEqual({
      state: 'COMPLETE',
      reason: null,
      points: [
        {
          periodEndDate: '2026-09-07',
          knownWeightedPlannedProgressPercent: '24',
        },
        {
          periodEndDate: '2026-09-14',
          knownWeightedPlannedProgressPercent: '100',
        },
      ],
    });
  });

  it('keeps a missing WORK_ITEM incomplete and never promotes its absence to zero', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '10', '60', 0), item('missing', '20', '40', 1)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-07', '10'),
      ],
    });

    expect(projection.readinessState).toBe('REVISION_IN_PROGRESS');
    expect(projection.blockers).toContainEqual(
      expect.objectContaining({
        code: EXECUTION_PLAN_BLOCKER.MISSING_WORK_ITEM_DISTRIBUTION,
        boqItemId: 'missing',
      }),
    );
    expect(projection.plannedCurve).toEqual({
      state: 'INCOMPLETE',
      reason: 'KNOWN_SUBTOTAL_ONLY',
      points: [
        {
          periodEndDate: '2026-09-07',
          knownWeightedPlannedProgressPercent: '60',
        },
      ],
    });
  });

  it('treats interval boundaries as inclusive and rejects a shared boundary overlap', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '10', '100', 0)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-07', '5'),
        period('a2', 'a', '2026-09-07', '2026-09-14', '5'),
      ],
    });

    expect(projection.blockers).toContainEqual({
      code: EXECUTION_PLAN_BLOCKER.DISTRIBUTION_INTERVAL_OVERLAP,
      boqItemId: 'a',
    });
  });

  it('keeps a weekly interval whole and creates no interpolated daily points', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '10', '100', 0)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-07', '10'),
      ],
    });

    expect(projection.plannedCurve.points).toHaveLength(1);
    expect(projection.plannedCurve.points[0].periodEndDate).toBe('2026-09-07');
  });

  it('credits each planned increment only at period end, never at start or by daily interpolation', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '100', '100', 0)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-07', '20'),
        period('a2', 'a', '2026-09-08', '2026-09-14', '30'),
      ],
    });

    expect(projection.plannedCurve).toEqual({
      state: 'INCOMPLETE',
      reason: 'KNOWN_SUBTOTAL_ONLY',
      points: [
        {
          periodEndDate: '2026-09-07',
          knownWeightedPlannedProgressPercent: '20',
        },
        {
          periodEndDate: '2026-09-14',
          knownWeightedPlannedProgressPercent: '50',
        },
      ],
    });
    expect(
      projection.plannedCurve.points.map((point) => point.periodEndDate),
    ).not.toEqual(expect.arrayContaining(['2026-09-01', '2026-09-08']));
  });

  it('fails closed for under-plan, over-plan, foreign item, and unavailable weight', () => {
    const projection = projectExecutionPlan({
      projectStatus: ProjectStatus.PLANNED,
      planStatus: 'DRAFT',
      draftFlow: EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
      totalBaseCost: new Prisma.Decimal('100'),
      items: [item('a', '10', null, 0)],
      distributions: [
        period('a1', 'a', '2026-09-01', '2026-09-02', '11'),
        period('foreign', 'foreign', '2026-09-03', '2026-09-04', '1'),
      ],
    });

    expect(projection.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        EXECUTION_PLAN_BLOCKER.PLANNED_QUANTITY_EXCEEDS_BASELINE,
        EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_WORK_ITEM,
        EXECUTION_PLAN_BLOCKER.H2A1_WEIGHT_UNAVAILABLE,
      ]),
    );
    expect(projection.plannedCurve.state).toBe('UNAVAILABLE');
  });
});

import { Prisma, ProjectStatus } from '@prisma/client';
import { projectMonitoringWeights } from '../progress/monitoring-weight';
import {
  EXECUTION_PLAN_BLOCKER,
  EXECUTION_PLAN_READINESS,
  type ExecutionPlanBlocker,
} from './execution-plan.contracts';
import {
  EXECUTION_PLAN_DRAFT_FLOW,
  type ExecutionPlanDraftFlow,
} from './execution-plan-adoption.policy';

export interface ExecutionPlanProjectionItem {
  id: string;
  parentId: string | null;
  wbsNodeId: string | null;
  wbsCode: string;
  name: string;
  itemType: string;
  sortOrder: number;
  quantity: Prisma.Decimal;
  unit: string;
  lineTotal: Prisma.Decimal | null;
}

export interface ExecutionPlanProjectionDistribution {
  id: string;
  boqItemId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  plannedIncrementalQuantity: Prisma.Decimal;
}

export interface ExecutionPlanProjectionInput {
  projectStatus: ProjectStatus;
  planStatus: 'DRAFT' | 'LOCKED';
  draftFlow: ExecutionPlanDraftFlow;
  totalBaseCost: Prisma.Decimal | null;
  items: ExecutionPlanProjectionItem[];
  distributions: ExecutionPlanProjectionDistribution[];
}

const dateWire = (value: Date): string => value.toISOString().slice(0, 10);

const decimalWire = (value: Prisma.Decimal): string =>
  value
    .toFixed(20, Prisma.Decimal.ROUND_HALF_UP)
    .replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');

export function projectExecutionPlan(input: ExecutionPlanProjectionInput) {
  const workItems = input.items.filter((item) => item.itemType === 'WORK_ITEM');
  const workItemById = new Map(workItems.map((item) => [item.id, item]));
  const requiredWorkItems = workItems.filter((item) => item.quantity.greaterThan(0));
  const distributionsByItem = new Map<
    string,
    ExecutionPlanProjectionDistribution[]
  >();
  const blockers: ExecutionPlanBlocker[] = [];

  const validDraftContext =
    (input.projectStatus === ProjectStatus.PLANNED &&
      input.draftFlow === EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW) ||
    (input.projectStatus === ProjectStatus.ACTIVE &&
      input.draftFlow === EXECUTION_PLAN_DRAFT_FLOW.LEGACY_ACTIVE_ADOPTION);
  if (input.planStatus !== 'LOCKED' && !validDraftContext) {
    blockers.push({ code: EXECUTION_PLAN_BLOCKER.PROJECT_NOT_PLANNED });
  }
  if (requiredWorkItems.length === 0) {
    blockers.push({ code: EXECUTION_PLAN_BLOCKER.NO_REQUIRED_WORK_ITEMS });
  }

  for (const distribution of input.distributions) {
    const item = workItemById.get(distribution.boqItemId);
    if (!item) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_WORK_ITEM,
        boqItemId: distribution.boqItemId,
      });
      continue;
    }
    if (distribution.periodStartDate > distribution.periodEndDate) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_DATE,
        boqItemId: item.id,
      });
    }
    if (!distribution.plannedIncrementalQuantity.greaterThan(0)) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_QUANTITY,
        boqItemId: item.id,
      });
    }
    const grouped = distributionsByItem.get(item.id) ?? [];
    grouped.push(distribution);
    distributionsByItem.set(item.id, grouped);
  }

  for (const item of workItems) {
    const rows = [...(distributionsByItem.get(item.id) ?? [])].sort(
      (left, right) =>
        left.periodStartDate.getTime() - right.periodStartDate.getTime() ||
        left.periodEndDate.getTime() - right.periodEndDate.getTime() ||
        left.id.localeCompare(right.id),
    );
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].periodStartDate <= rows[index - 1].periodEndDate) {
        blockers.push({
          code: EXECUTION_PLAN_BLOCKER.DISTRIBUTION_INTERVAL_OVERLAP,
          boqItemId: item.id,
        });
        break;
      }
    }
    const total = rows.reduce(
      (sum, row) => sum.add(row.plannedIncrementalQuantity),
      new Prisma.Decimal(0),
    );
    if (item.quantity.greaterThan(0) && rows.length === 0) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.MISSING_WORK_ITEM_DISTRIBUTION,
        boqItemId: item.id,
        expectedQuantity: decimalWire(item.quantity),
      });
    } else if (total.lessThan(item.quantity)) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.PLANNED_QUANTITY_INCOMPLETE,
        boqItemId: item.id,
        expectedQuantity: decimalWire(item.quantity),
        plannedQuantity: decimalWire(total),
      });
    } else if (total.greaterThan(item.quantity)) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.PLANNED_QUANTITY_EXCEEDS_BASELINE,
        boqItemId: item.id,
        expectedQuantity: decimalWire(item.quantity),
        plannedQuantity: decimalWire(total),
      });
    }
  }

  const weights = projectMonitoringWeights(input.items, input.totalBaseCost);
  if (weights.project.completeness !== 'COMPLETE') {
    blockers.push({ code: EXECUTION_PLAN_BLOCKER.H2A1_WEIGHT_UNAVAILABLE });
  }

  const schedule = workItems
    .map((item) => {
      const rows = [...(distributionsByItem.get(item.id) ?? [])].sort(
        (left, right) => left.periodStartDate.getTime() - right.periodStartDate.getTime(),
      );
      if (rows.length === 0) return null;
      const planned = rows.reduce(
        (sum, row) => sum.add(row.plannedIncrementalQuantity),
        new Prisma.Decimal(0),
      );
      return {
        boqItemId: item.id,
        wbsCode: item.wbsCode,
        name: item.name,
        unit: item.unit,
        baselineQuantity: decimalWire(item.quantity),
        plannedQuantity: decimalWire(planned),
        plannedItemProgressPercent: item.quantity.isZero()
          ? null
          : decimalWire(planned.mul(100).div(item.quantity)),
        plannedStartDate: dateWire(rows[0].periodStartDate),
        plannedFinishDate: dateWire(
          rows.reduce(
            (latest, row) =>
              row.periodEndDate > latest ? row.periodEndDate : latest,
            rows[0].periodEndDate,
          ),
        ),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort(
      (left, right) =>
        (workItemById.get(left.boqItemId)?.sortOrder ?? 0) -
        (workItemById.get(right.boqItemId)?.sortOrder ?? 0),
    );

  const weightUnavailable = workItems.some(
    (item) => weights.rows.get(item.id)?.own.state !== 'AVAILABLE',
  );
  const boundaries = Array.from(
    new Set(input.distributions.map((row) => dateWire(row.periodEndDate))),
  ).sort();
  const curvePoints = weightUnavailable
    ? []
    : boundaries.map((boundary) => {
        const boundaryDate = new Date(`${boundary}T00:00:00.000Z`);
        const knownContribution = workItems.reduce((projectSum, item) => {
          const itemRows = distributionsByItem.get(item.id);
          if (!itemRows?.length || item.quantity.isZero()) return projectSum;
          // MON-04 v1 temporal law: one interval's full incremental quantity
          // becomes cumulative at its inclusive periodEndDate only. There is
          // no start-date credit and no interpolation inside the interval.
          const cumulative = itemRows.reduce(
            (sum, row) =>
              row.periodEndDate <= boundaryDate
                ? sum.add(row.plannedIncrementalQuantity)
                : sum,
            new Prisma.Decimal(0),
          );
          const itemWeight = weights.rows.get(item.id)!.own;
          return itemWeight.state === 'AVAILABLE'
            ? projectSum.add(
                new Prisma.Decimal(itemWeight.percentage).mul(cumulative).div(item.quantity),
              )
            : projectSum;
        }, new Prisma.Decimal(0));
        return {
          periodEndDate: boundary,
          knownWeightedPlannedProgressPercent: decimalWire(knownContribution),
        };
      });

  const lockable = blockers.length === 0;
  const readinessState =
    input.planStatus === 'LOCKED' && lockable
      ? EXECUTION_PLAN_READINESS.LOCKED_FOR_EXECUTION
      : input.planStatus === 'LOCKED'
        ? EXECUTION_PLAN_READINESS.PLAN_NOT_READY
        : lockable
          ? EXECUTION_PLAN_READINESS.READY_FOR_LOCK
          : EXECUTION_PLAN_READINESS.REVISION_IN_PROGRESS;

  return {
    readinessState,
    blockers,
    schedule,
    workPlan: workItems.map((item) => ({
      boqItemId: item.id,
      parentId: item.parentId,
      wbsNodeId: item.wbsNodeId,
      wbsCode: item.wbsCode,
      name: item.name,
      unit: item.unit,
      baselineQuantity: decimalWire(item.quantity),
      distributionCount: distributionsByItem.get(item.id)?.length ?? 0,
    })),
    plannedCurve: weightUnavailable
      ? {
          state: 'UNAVAILABLE' as const,
          reason: EXECUTION_PLAN_BLOCKER.H2A1_WEIGHT_UNAVAILABLE,
          points: [],
        }
      : {
          state: lockable ? ('COMPLETE' as const) : ('INCOMPLETE' as const),
          reason: lockable ? null : 'KNOWN_SUBTOTAL_ONLY',
          points: curvePoints,
        },
    weight: weights.project,
  };
}

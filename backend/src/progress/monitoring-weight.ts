import { Prisma } from '@prisma/client';

export const MONITORING_WEIGHT_BASIS =
  'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST' as const;

export const MONITORING_WEIGHT_REASON = {
  BASELINE_VALUE_UNAVAILABLE: 'BASELINE_VALUE_UNAVAILABLE',
  ZERO_BASELINE_DENOMINATOR: 'ZERO_BASELINE_DENOMINATOR',
  INVALID_BASELINE_DENOMINATOR: 'INVALID_BASELINE_DENOMINATOR',
  ITEM_VALUE_UNAVAILABLE: 'ITEM_VALUE_UNAVAILABLE',
  INCOMPLETE_BASELINE_VALUE_COVERAGE: 'INCOMPLETE_BASELINE_VALUE_COVERAGE',
} as const;

export type MonitoringWeightReason =
  (typeof MONITORING_WEIGHT_REASON)[keyof typeof MONITORING_WEIGHT_REASON];

export type MonitoringWeightFact =
  | {
      state: 'AVAILABLE';
      percentage: string;
      reason: null;
    }
  | {
      state: 'UNAVAILABLE';
      percentage: null;
      reason: MonitoringWeightReason;
    }
  | {
      state: 'NOT_APPLICABLE';
      percentage: null;
      reason: null;
    };

export interface MonitoringRowWeight {
  /** Only a WORK_ITEM owns money. Structural rows never do. */
  own: MonitoringWeightFact;
  /** Only a FOLDER aggregates descendant WORK_ITEM values. */
  subtree: MonitoringWeightFact;
  /** Running RAB composition in canonical depth-first WORK_ITEM order. */
  cumulative: MonitoringWeightFact;
}

export interface MonitoringProjectWeight {
  basis: typeof MONITORING_WEIGHT_BASIS;
  completeness: 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
  reason: MonitoringWeightReason | null;
  denominator: {
    state: 'AVAILABLE' | 'UNAVAILABLE';
    value: string | null;
  };
  eligibleWorkItemCount: number;
  weightedWorkItemCount: number;
  unavailableWorkItemCount: number;
}

export interface MonitoringWeightSourceRow {
  id: string;
  parentId: string | null;
  itemType: string;
  sortOrder: number;
  /** Persisted Baseline RAB line value. Never recomputed in Monitoring. */
  lineTotal: Prisma.Decimal | null;
}

export interface MonitoringWeightProjection {
  project: MonitoringProjectWeight;
  rows: Map<string, MonitoringRowWeight>;
}

type OrderedRow = MonitoringWeightSourceRow & { depth: number };

const unavailable = (reason: MonitoringWeightReason): MonitoringWeightFact => ({
  state: 'UNAVAILABLE',
  percentage: null,
  reason,
});

const notApplicable = (): MonitoringWeightFact => ({
  state: 'NOT_APPLICABLE',
  percentage: null,
  reason: null,
});

const percentageWireValue = (value: Prisma.Decimal): string =>
  value
    .toFixed(20, Prisma.Decimal.ROUND_HALF_UP)
    .replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');

const percentage = (
  value: Prisma.Decimal,
  denominator: Prisma.Decimal,
): MonitoringWeightFact => ({
  state: 'AVAILABLE',
  // Prisma.Decimal performs the authoritative division. Nothing is rounded
  // per row before subtree or cumulative values are calculated: those facts
  // are derived independently from exact persisted money below.
  // Fixed-point wire notation prevents a very small legitimate weight from
  // becoming scientific notation that a bounded presentation parser could
  // mistake for unavailable. Decimal's full 20-digit calculation precision
  // is retained; the human-facing two-decimal rounding still happens last.
  percentage: percentageWireValue(value.mul(100).div(denominator)),
  reason: null,
});

/**
 * The same conservative depth-first law used by H2-A0's RAB numbering:
 * sort siblings by sortOrder, keep missing-parent rows visible as roots, and
 * never drop a cyclic legacy row. Lawful RAB writes already reject malformed
 * structures; this fallback preserves H2-A0 read visibility for old data.
 */
const orderDepthFirst = (
  rows: readonly MonitoringWeightSourceRow[],
): OrderedRow[] => {
  const sorted = rows
    .map((row, inputOrder) => ({ row, inputOrder }))
    .sort((left, right) =>
      left.row.sortOrder === right.row.sortOrder
        ? left.inputOrder - right.inputOrder
        : left.row.sortOrder - right.row.sortOrder,
    )
    .map(({ row }) => row);
  const present = new Set(sorted.map((row) => row.id));
  const children = new Map<string | null, MonitoringWeightSourceRow[]>();
  for (const row of sorted) {
    const parent =
      row.parentId && present.has(row.parentId) ? row.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }

  const result: OrderedRow[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const row of children.get(parentId) ?? []) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      result.push({ ...row, depth });
      visit(row.id, depth + 1);
    }
  };

  visit(null, 0);
  for (const row of sorted) {
    if (visited.has(row.id)) continue;
    visited.add(row.id);
    result.push({ ...row, depth: 0 });
    visit(row.id, 1);
  }
  return result;
};

/**
 * Pure H2-A1 projection over already-authoritative Baseline RAB money.
 *
 * This function does not calculate unit price, line value, margin, tax, or a
 * RAB total. It consumes `BoqItem.lineTotal` and `RabDocument.totalBaseCost`
 * exactly as persisted, and reports incomplete/unavailable truth without
 * renormalizing the rows that happen to be known.
 */
export function projectMonitoringWeights(
  sourceRows: readonly MonitoringWeightSourceRow[],
  denominatorInput: Prisma.Decimal | null,
): MonitoringWeightProjection {
  const ordered = orderDepthFirst(sourceRows);
  const workItems = ordered.filter((row) => row.itemType === 'WORK_ITEM');
  const eligibleWorkItemCount = workItems.length;
  const denominator =
    denominatorInput === null ? null : new Prisma.Decimal(denominatorInput);
  const denominatorReason =
    denominator === null
      ? MONITORING_WEIGHT_REASON.BASELINE_VALUE_UNAVAILABLE
      : denominator.isZero()
        ? MONITORING_WEIGHT_REASON.ZERO_BASELINE_DENOMINATOR
        : denominator.isNegative()
          ? MONITORING_WEIGHT_REASON.INVALID_BASELINE_DENOMINATOR
          : null;
  const denominatorAvailable =
    denominatorReason === null && denominator !== null;

  const monetaryValues = new Map<string, Prisma.Decimal | null>(
    workItems.map((row) => [
      row.id,
      row.lineTotal === null ? null : new Prisma.Decimal(row.lineTotal),
    ]),
  );
  const availableWorkItemCount = workItems.filter(
    (row) => monetaryValues.get(row.id) !== null,
  ).length;
  const weightedWorkItemCount = denominatorAvailable
    ? availableWorkItemCount
    : 0;
  const unavailableWorkItemCount =
    eligibleWorkItemCount - weightedWorkItemCount;
  const itemValueSum = [...monetaryValues.values()].reduce<Prisma.Decimal>(
    (sum, value) => (value === null ? sum : sum.add(value)),
    new Prisma.Decimal(0),
  );
  const coverageComplete =
    denominatorAvailable &&
    availableWorkItemCount === eligibleWorkItemCount &&
    itemValueSum.equals(denominator);

  const project: MonitoringProjectWeight = {
    basis: MONITORING_WEIGHT_BASIS,
    completeness: denominatorReason
      ? 'UNAVAILABLE'
      : coverageComplete
        ? 'COMPLETE'
        : 'INCOMPLETE',
    reason:
      denominatorReason ??
      (coverageComplete
        ? null
        : MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE),
    denominator: denominatorAvailable
      ? {
          state: 'AVAILABLE',
          value: denominator.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
        }
      : { state: 'UNAVAILABLE', value: null },
    eligibleWorkItemCount,
    weightedWorkItemCount,
    unavailableWorkItemCount,
  };

  const workItemPosition = new Map<string, number>();
  const prefixValue: Prisma.Decimal[] = [];
  const prefixMissing: number[] = [];
  let runningValue = new Prisma.Decimal(0);
  let runningMissing = 0;
  workItems.forEach((row, index) => {
    workItemPosition.set(row.id, index);
    const value = monetaryValues.get(row.id) ?? null;
    if (value === null) runningMissing += 1;
    else runningValue = runningValue.add(value);
    prefixValue.push(runningValue);
    prefixMissing.push(runningMissing);
  });

  const rowIndex = new Map(ordered.map((row, index) => [row.id, index]));
  const descendantWorkItems = (row: OrderedRow): OrderedRow[] => {
    const start = rowIndex.get(row.id)!;
    const descendants: OrderedRow[] = [];
    for (let index = start + 1; index < ordered.length; index += 1) {
      const candidate = ordered[index];
      if (candidate.depth <= row.depth) break;
      if (candidate.itemType === 'WORK_ITEM') descendants.push(candidate);
    }
    return descendants;
  };

  const rowWeights = new Map<string, MonitoringRowWeight>();
  for (const row of ordered) {
    if (row.itemType === 'NOTE') {
      rowWeights.set(row.id, {
        own: notApplicable(),
        subtree: notApplicable(),
        cumulative: notApplicable(),
      });
      continue;
    }

    const relevantWorkItems =
      row.itemType === 'WORK_ITEM' ? [row] : descendantWorkItems(row);
    const ownValue =
      row.itemType === 'WORK_ITEM'
        ? (monetaryValues.get(row.id) ?? null)
        : null;

    const own =
      row.itemType !== 'WORK_ITEM'
        ? notApplicable()
        : denominatorReason
          ? unavailable(denominatorReason)
          : ownValue === null
            ? unavailable(MONITORING_WEIGHT_REASON.ITEM_VALUE_UNAVAILABLE)
            : percentage(ownValue, denominator!);

    let subtree: MonitoringWeightFact = notApplicable();
    if (row.itemType !== 'WORK_ITEM') {
      const missingInSubtree = relevantWorkItems.some(
        (item) => monetaryValues.get(item.id) === null,
      );
      const subtreeValue = relevantWorkItems.reduce(
        (sum, item) => sum.add(monetaryValues.get(item.id) ?? 0),
        new Prisma.Decimal(0),
      );
      subtree = denominatorReason
        ? unavailable(denominatorReason)
        : missingInSubtree
          ? unavailable(
              MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE,
            )
          : percentage(subtreeValue, denominator!);
    }

    const lastWorkItem = relevantWorkItems.at(-1);
    const cumulativePosition = lastWorkItem
      ? workItemPosition.get(lastWorkItem.id)
      : undefined;
    const cumulative =
      cumulativePosition === undefined
        ? notApplicable()
        : denominatorReason
          ? unavailable(denominatorReason)
          : prefixMissing[cumulativePosition] > 0
            ? unavailable(
                MONITORING_WEIGHT_REASON.INCOMPLETE_BASELINE_VALUE_COVERAGE,
              )
            : percentage(prefixValue[cumulativePosition], denominator!);

    rowWeights.set(row.id, { own, subtree, cumulative });
  }

  return { project, rows: rowWeights };
}

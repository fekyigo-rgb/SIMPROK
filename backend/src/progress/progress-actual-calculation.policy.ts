import { ProgressActualStatus } from '@prisma/client';

export interface ProgressCalculationLineageEntry {
  id: string;
  supersedesEntryId: string | null;
}

export type ProgressCalculationLineageInvalidReason =
  | 'DUPLICATE_ID'
  | 'SELF_REFERENCE'
  | 'MISSING_PREDECESSOR'
  | 'MULTIPLE_DIRECT_CHILDREN'
  | 'CYCLE';

export type ProgressCalculationLineageSelection<T> =
  | {
      state: 'VALID';
      leaves: readonly T[];
    }
  | {
      state: 'INVALID_LINEAGE';
      reason: ProgressCalculationLineageInvalidReason;
      leaves: readonly [];
    };

/**
 * Owner-ratified per-record authority for official SIMPROK calculation.
 *
 * This deliberately depends on lifecycle status alone. Display selection,
 * capture channel, actor authority, evidence, time, Baseline scope, and period
 * selection are different concerns and must not be smuggled into this policy.
 */
export function isProgressActualCalculationEligible(
  status: ProgressActualStatus,
): boolean {
  switch (status) {
    case ProgressActualStatus.VERIFIED:
    case ProgressActualStatus.ACCEPTED:
      return true;
    case ProgressActualStatus.LEGACY_UNSPECIFIED:
    case ProgressActualStatus.RECORDED:
    case ProgressActualStatus.SUBMITTED:
    case ProgressActualStatus.RETURNED_FOR_CORRECTION:
      return false;
  }

  const unhandledStatus: never = status;
  void unhandledStatus;
  return false;
}

const invalidLineage = <T>(
  reason: ProgressCalculationLineageInvalidReason,
): ProgressCalculationLineageSelection<T> => ({
  state: 'INVALID_LINEAGE',
  reason,
  leaves: [],
});

/**
 * Selects one current leaf for every independent correction lineage.
 *
 * The caller owns project/Baseline/WORK_ITEM query scope and must supply the
 * complete homogeneous candidate set. This pure policy validates only lineage
 * identity. It never filters by lifecycle status: callers must compose lineage
 * selection first and status eligibility second, so a superseded eligible
 * predecessor can never reappear as fallback.
 *
 * Valid leaves preserve their order in the supplied candidate set.
 */
export function selectCurrentCalculationLineageLeaves<
  T extends ProgressCalculationLineageEntry,
>(entries: readonly T[]): ProgressCalculationLineageSelection<T> {
  const byId = new Map<string, T>();

  for (const entry of entries) {
    if (byId.has(entry.id)) return invalidLineage('DUPLICATE_ID');
    byId.set(entry.id, entry);
  }

  const childByPredecessor = new Map<string, string>();
  for (const entry of entries) {
    const predecessorId = entry.supersedesEntryId;
    if (predecessorId === null) continue;
    if (predecessorId === entry.id) return invalidLineage('SELF_REFERENCE');
    if (!byId.has(predecessorId)) return invalidLineage('MISSING_PREDECESSOR');
    if (childByPredecessor.has(predecessorId))
      return invalidLineage('MULTIPLE_DIRECT_CHILDREN');
    childByPredecessor.set(predecessorId, entry.id);
  }

  const visitState = new Map<string, 'VISITING' | 'VISITED'>();
  for (const entry of entries) {
    if (visitState.get(entry.id) === 'VISITED') continue;

    const path: string[] = [];
    let cursor: T | undefined = entry;
    while (cursor) {
      const state = visitState.get(cursor.id);
      if (state === 'VISITING') return invalidLineage('CYCLE');
      if (state === 'VISITED') break;

      visitState.set(cursor.id, 'VISITING');
      path.push(cursor.id);
      cursor =
        cursor.supersedesEntryId !== null
          ? byId.get(cursor.supersedesEntryId)
          : undefined;
    }

    for (const id of path) visitState.set(id, 'VISITED');
  }

  return {
    state: 'VALID',
    leaves: entries.filter((entry) => !childByPredecessor.has(entry.id)),
  };
}

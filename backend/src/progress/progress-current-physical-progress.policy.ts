import { Prisma } from '@prisma/client';
import type { CurrentOfficialQuantityResult } from './progress-current-official-quantity.policy';

export type WorkItemCurrentPhysicalProgressUnavailableReason =
  | 'PLANNED_QUANTITY_UNAVAILABLE'
  | 'PLANNED_QUANTITY_INVALID'
  | 'PLANNED_QUANTITY_ZERO'
  | 'SAME_WORK_ITEM_UNIT_CONTEXT_UNAVAILABLE';

type Law1PassthroughResult = Exclude<
  CurrentOfficialQuantityResult,
  { state: 'COMPLETE' } | { state: 'INCOMPLETE' }
>;

export type WorkItemCurrentPhysicalProgressResult =
  | Law1PassthroughResult
  | {
      state: 'INCOMPLETE';
      knownProgressSubtotalPercent?: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason: WorkItemCurrentPhysicalProgressUnavailableReason;
    }
  | {
      state: 'COMPLETE';
      rawPhysicalProgressPercent: Prisma.Decimal;
      boundedContributionProgressPercent: Prisma.Decimal;
    };

export interface WorkItemCurrentPhysicalProgressInput {
  currentOfficialQuantity: CurrentOfficialQuantityResult;
  plannedQuantity: Prisma.Decimal | string | null | undefined;
  plannedUnit: string | null | undefined;
}

type PlannedQuantityValidation =
  | {
      state: 'VALID';
      value: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason:
        | 'PLANNED_QUANTITY_UNAVAILABLE'
        | 'PLANNED_QUANTITY_INVALID'
        | 'PLANNED_QUANTITY_ZERO';
    };

const validatePlannedQuantity = (
  plannedQuantity: WorkItemCurrentPhysicalProgressInput['plannedQuantity'],
): PlannedQuantityValidation => {
  if (plannedQuantity === null || plannedQuantity === undefined) {
    return {
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_UNAVAILABLE',
    };
  }

  let value: Prisma.Decimal;

  try {
    value = new Prisma.Decimal(plannedQuantity.toString());
  } catch {
    return {
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_INVALID',
    };
  }

  if (value.isNaN() || !value.isFinite() || value.isNegative()) {
    return {
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_INVALID',
    };
  }

  if (value.isZero()) {
    return {
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_ZERO',
    };
  }

  return {
    state: 'VALID',
    value,
  };
};

const hasUsableSameWorkItemUnitContext = (
  plannedUnit: WorkItemCurrentPhysicalProgressInput['plannedUnit'],
): boolean => typeof plannedUnit === 'string' && plannedUnit.trim().length > 0;

/**
 * Owner-ratified MON-04 LAW 2:
 * WORK_ITEM Current Physical Progress.
 *
 * Upstream quantity truth is owned exclusively by LAW 1.
 * This policy never reads ProgressEntry facts, lineage, lifecycle,
 * semantic authority, RAB weight, H2-A1, persistence, or unit conversion.
 *
 * Official numeric item progress exists only when:
 *
 * LAW1 = COMPLETE(quantity)
 * + planned quantity is finite and strictly positive
 * + the same Active-Baseline WORK_ITEM has a nonblank contextual unit.
 *
 * RAW progress remains uncapped.
 * Only bounded contribution is capped at 100%.
 *
 * No intermediate rounding is performed.
 */
export function calculateWorkItemCurrentPhysicalProgress(
  input: Readonly<WorkItemCurrentPhysicalProgressInput>,
): WorkItemCurrentPhysicalProgressResult {
  const quantityResult = input.currentOfficialQuantity;

  switch (quantityResult.state) {
    case 'NOT_YET_RECORDED':
    case 'NO_ELIGIBLE_CURRENT_FACT':
    case 'INVALID_LINEAGE':
    case 'INVALID_NUMERIC_FACT':
    case 'SEMANTICS_UNPROVEN':
      return quantityResult;
    case 'INCOMPLETE':
    case 'COMPLETE':
      break;
  }

  const plannedQuantity = validatePlannedQuantity(input.plannedQuantity);
  const unitContextAvailable = hasUsableSameWorkItemUnitContext(
    input.plannedUnit,
  );

  if (quantityResult.state === 'INCOMPLETE') {
    if (plannedQuantity.state !== 'VALID' || !unitContextAvailable) {
      return { state: 'INCOMPLETE' };
    }

    return {
      state: 'INCOMPLETE',
      knownProgressSubtotalPercent: quantityResult.knownEligibleQuantitySubtotal
        .mul(100)
        .div(plannedQuantity.value),
    };
  }

  if (plannedQuantity.state !== 'VALID') {
    return {
      state: 'UNAVAILABLE',
      reason: plannedQuantity.reason,
    };
  }

  if (!unitContextAvailable) {
    return {
      state: 'UNAVAILABLE',
      reason: 'SAME_WORK_ITEM_UNIT_CONTEXT_UNAVAILABLE',
    };
  }

  const rawPhysicalProgressPercent = quantityResult.currentOfficialQuantity
    .mul(100)
    .div(plannedQuantity.value);

  const boundedContributionProgressPercent =
    rawPhysicalProgressPercent.greaterThan(100)
      ? new Prisma.Decimal(100)
      : rawPhysicalProgressPercent;

  return {
    state: 'COMPLETE',
    rawPhysicalProgressPercent,
    boundedContributionProgressPercent,
  };
}

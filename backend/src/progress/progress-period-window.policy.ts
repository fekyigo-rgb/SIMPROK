import { Prisma } from '@prisma/client';
import type { ExecutionPlanProjectionDistribution } from '../execution-plan/execution-plan-projection.policy';
import type { ProgressComparisonPlannedCurve } from './progress-planned-actual-comparison.policy';
import {
  projectBusinessDateWire,
  workDateWire,
} from './progress-actual-temporal-quantity.policy';
import type {
  CurrentGovernedOfficialFact,
  CurrentGovernedOfficialFactsResult,
  CurrentOfficialQuantityResult,
  Law1CalculationEntry,
} from './progress-current-official-quantity.policy';

export const PERIOD_WINDOW_MODE =
  'CANONICAL_PLANNED_AND_ACTUAL_ITEM_PERIOD_WINDOW' as const;

export const PERIOD_WINDOW_BOUNDARY_BASIS =
  'INCLUSIVE_PROJECT_BUSINESS_DATE_WINDOW' as const;

export const ACTUAL_PERIOD_WINDOW_TRUTH_MODE =
  'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_EXPLICIT_WORKDATE_WINDOW' as const;

export type ProjectBusinessDateWindow = {
  startDate: string;
  endDate: string;
};

export type ProjectBusinessDateWindowValidationResult =
  | { state: 'VALID'; window: ProjectBusinessDateWindow }
  | {
      state: 'INVALID';
      reason:
        | 'INVALID_PERIOD_WINDOW_START_DATE'
        | 'INVALID_PERIOD_WINDOW_END_DATE'
        | 'PERIOD_WINDOW_START_AFTER_END';
    };

export type PlannedItemQuantityProjection =
  | {
      state: 'COMPLETE';
      plannedQuantity: Prisma.Decimal;
    }
  | {
      state: 'INCOMPLETE';
      reason: string;
      knownPlannedQuantitySubtotal: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
    };

export type PlannedItemPeriodWindowProjection = {
  periodQuantity: PlannedItemQuantityProjection;
  cumulativeQuantityThroughEndDate: PlannedItemQuantityProjection;
};

export type ActualItemPeriodOfficialFactsResult<
  T extends Law1CalculationEntry = Law1CalculationEntry,
> =
  | Exclude<
      CurrentGovernedOfficialFactsResult<T>,
      { state: 'INCOMPLETE' | 'COMPLETE' }
    >
  | {
      state: 'INCOMPLETE' | 'COMPLETE';
      facts: readonly CurrentGovernedOfficialFact<T>[];
    };

export function validateProjectBusinessDateWindow(
  startDate: unknown,
  endDate: unknown,
): ProjectBusinessDateWindowValidationResult {
  const validStartDate = projectBusinessDateWire(startDate);
  if (validStartDate === null) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_WINDOW_START_DATE' };
  }

  const validEndDate = projectBusinessDateWire(endDate);
  if (validEndDate === null) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_WINDOW_END_DATE' };
  }

  if (validStartDate > validEndDate) {
    return { state: 'INVALID', reason: 'PERIOD_WINDOW_START_AFTER_END' };
  }

  return {
    state: 'VALID',
    window: { startDate: validStartDate, endDate: validEndDate },
  };
}

export function projectPlannedItemPeriodWindow(input: {
  boqItemId: string;
  window: ProjectBusinessDateWindow;
  plannedCurve: ProgressComparisonPlannedCurve;
  distributions: readonly ExecutionPlanProjectionDistribution[];
}): PlannedItemPeriodWindowProjection {
  if (input.plannedCurve.state === 'UNAVAILABLE') {
    const unavailable = {
      state: 'UNAVAILABLE' as const,
      reason: input.plannedCurve.reason,
    };
    return {
      periodQuantity: unavailable,
      cumulativeQuantityThroughEndDate: unavailable,
    };
  }

  let periodQuantity = new Prisma.Decimal(0);
  let cumulativeQuantity = new Prisma.Decimal(0);
  let hasUnplaceableDistribution = false;

  for (const distribution of input.distributions) {
    if (distribution.boqItemId !== input.boqItemId) continue;

    const creditDate = workDateWire(distribution.periodEndDate);
    if (creditDate === null) {
      hasUnplaceableDistribution = true;
      continue;
    }

    if (creditDate <= input.window.endDate) {
      cumulativeQuantity = cumulativeQuantity.plus(
        distribution.plannedIncrementalQuantity,
      );
    }

    if (
      creditDate >= input.window.startDate &&
      creditDate <= input.window.endDate
    ) {
      periodQuantity = periodQuantity.plus(
        distribution.plannedIncrementalQuantity,
      );
    }
  }

  if (input.plannedCurve.state === 'INCOMPLETE' || hasUnplaceableDistribution) {
    const reason = hasUnplaceableDistribution
      ? 'INVALID_DISTRIBUTION_DATE'
      : (input.plannedCurve.reason ?? 'KNOWN_SUBTOTAL_ONLY');
    return {
      periodQuantity: {
        state: 'INCOMPLETE',
        reason,
        knownPlannedQuantitySubtotal: periodQuantity,
      },
      cumulativeQuantityThroughEndDate: {
        state: 'INCOMPLETE',
        reason,
        knownPlannedQuantitySubtotal: cumulativeQuantity,
      },
    };
  }

  return {
    periodQuantity: { state: 'COMPLETE', plannedQuantity: periodQuantity },
    cumulativeQuantityThroughEndDate: {
      state: 'COMPLETE',
      plannedQuantity: cumulativeQuantity,
    },
  };
}

export function projectActualItemPeriodOfficialFacts<
  T extends Law1CalculationEntry,
>(input: {
  governed: CurrentGovernedOfficialFactsResult<T>;
  window: ProjectBusinessDateWindow;
}): ActualItemPeriodOfficialFactsResult<T> {
  switch (input.governed.state) {
    case 'NOT_YET_RECORDED':
    case 'NO_ELIGIBLE_CURRENT_FACT':
    case 'INVALID_LINEAGE':
    case 'INVALID_NUMERIC_FACT':
    case 'SEMANTICS_UNPROVEN':
      return input.governed;
    case 'INCOMPLETE':
    case 'COMPLETE':
      break;
  }

  const facts: CurrentGovernedOfficialFact<T>[] = [];
  let hasUnplaceableCurrentFact = false;

  for (const fact of input.governed.eligibleCurrentFacts) {
    const workDate = workDateWire(fact.entry.workDate);

    if (workDate === null) {
      hasUnplaceableCurrentFact = true;
      continue;
    }

    if (
      workDate >= input.window.startDate &&
      workDate <= input.window.endDate
    ) {
      facts.push(fact);
    }
  }

  return {
    state:
      input.governed.state === 'INCOMPLETE' || hasUnplaceableCurrentFact
        ? 'INCOMPLETE'
        : 'COMPLETE',
    facts,
  };
}

export function projectActualItemPeriodWindow<
  T extends Law1CalculationEntry,
>(input: {
  governed: CurrentGovernedOfficialFactsResult<T>;
  window: ProjectBusinessDateWindow;
}): CurrentOfficialQuantityResult {
  const periodFacts = projectActualItemPeriodOfficialFacts(input);
  switch (periodFacts.state) {
    case 'NOT_YET_RECORDED':
    case 'NO_ELIGIBLE_CURRENT_FACT':
    case 'INVALID_LINEAGE':
    case 'INVALID_NUMERIC_FACT':
    case 'SEMANTICS_UNPROVEN':
      return periodFacts;
    case 'INCOMPLETE':
    case 'COMPLETE':
      break;
  }

  let knownEligibleQuantitySubtotal = new Prisma.Decimal(0);
  for (const fact of periodFacts.facts) {
    knownEligibleQuantitySubtotal = knownEligibleQuantitySubtotal.plus(
      fact.quantity,
    );
  }

  return periodFacts.state === 'INCOMPLETE'
    ? { state: 'INCOMPLETE', knownEligibleQuantitySubtotal }
    : {
        state: 'COMPLETE',
        currentOfficialQuantity: knownEligibleQuantitySubtotal,
      };
}

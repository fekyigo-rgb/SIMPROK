import { Prisma } from '@prisma/client';
import {
  resolveCurrentGovernedOfficialFacts,
  type CurrentGovernedOfficialFactsResult,
  type CurrentOfficialQuantityResult,
  type Law1CalculationEntry,
} from './progress-current-official-quantity.policy';
import type { ProgressSemanticContextScope } from './progress-semantic-authority.policy';

export const ACTUAL_TEMPORAL_TRUTH_MODE =
  'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE' as const;

export const ACTUAL_TEMPORAL_SERIES_BOUNDARY_BASIS =
  'CURRENT_GOVERNED_WORKDATES_AND_REQUESTED_CUTOFF' as const;

export type ActualTemporalOfficialQuantityResult =
  | Exclude<CurrentOfficialQuantityResult, { state: 'INCOMPLETE' | 'COMPLETE' }>
  | {
      state: 'UNAVAILABLE';
      reason: 'INVALID_PROJECT_BUSINESS_CUTOFF';
    }
  | {
      state: 'INCOMPLETE';
      knownEligibleQuantitySubtotal: Prisma.Decimal;
    }
  | {
      state: 'COMPLETE';
      currentOfficialQuantity: Prisma.Decimal;
    };

export interface ActualTemporalOfficialQuantityInput<
  T extends Law1CalculationEntry = Law1CalculationEntry,
> {
  scope: ProgressSemanticContextScope;
  entries: readonly T[];
  cutoffDate: string;
}

export interface ActualTemporalOfficialQuantityProjectionInput<
  T extends Law1CalculationEntry = Law1CalculationEntry,
> {
  governed: CurrentGovernedOfficialFactsResult<T>;
  cutoffDate: string;
}

const PROJECT_BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const projectBusinessDateWire = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const match = PROJECT_BUSINESS_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
};

export const workDateWire = (value: Date | null): string | null => {
  if (value === null || Number.isNaN(value.getTime())) return null;

  const wire = value.toISOString();
  const businessDate = wire.slice(0, 10);
  return wire === `${businessDate}T00:00:00.000Z`
    ? projectBusinessDateWire(businessDate)
    : null;
};

export const prepareActualTemporalOfficialQuantity = <
  T extends Law1CalculationEntry,
>(
  scope: ProgressSemanticContextScope,
  entries: readonly T[],
): CurrentGovernedOfficialFactsResult<T> =>
  resolveCurrentGovernedOfficialFacts(scope, entries);

export function projectActualTemporalOfficialQuantity<
  T extends Law1CalculationEntry,
>(
  input: Readonly<ActualTemporalOfficialQuantityProjectionInput<T>>,
): ActualTemporalOfficialQuantityResult {
  if (projectBusinessDateWire(input.cutoffDate) === null) {
    return {
      state: 'UNAVAILABLE',
      reason: 'INVALID_PROJECT_BUSINESS_CUTOFF',
    };
  }

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

  let knownEligibleQuantitySubtotal = new Prisma.Decimal(0);
  let hasUnplaceableCurrentFact = false;

  for (const fact of input.governed.eligibleCurrentFacts) {
    const workDate = workDateWire(fact.entry.workDate);

    if (workDate === null) {
      hasUnplaceableCurrentFact = true;
      continue;
    }

    if (workDate <= input.cutoffDate) {
      knownEligibleQuantitySubtotal = knownEligibleQuantitySubtotal.plus(
        fact.quantity,
      );
    }
  }

  if (input.governed.state === 'INCOMPLETE' || hasUnplaceableCurrentFact) {
    return {
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal,
    };
  }

  return {
    state: 'COMPLETE',
    currentOfficialQuantity: knownEligibleQuantitySubtotal,
  };
}

export function actualTemporalSeriesBoundaries<T extends Law1CalculationEntry>(
  governedContexts: readonly CurrentGovernedOfficialFactsResult<T>[],
  cutoffDate: string,
): string[] {
  if (projectBusinessDateWire(cutoffDate) === null) {
    throw new Error('VALIDATED_TEMPORAL_CUTOFF_REQUIRED');
  }

  const boundaries = new Set<string>([cutoffDate]);

  for (const governed of governedContexts) {
    if (governed.state !== 'COMPLETE' && governed.state !== 'INCOMPLETE') {
      continue;
    }

    for (const fact of governed.eligibleCurrentFacts) {
      const workDate = workDateWire(fact.entry.workDate);
      if (workDate !== null && workDate <= cutoffDate) {
        boundaries.add(workDate);
      }
    }
  }

  return [...boundaries].sort();
}

/**
 * Owner-ratified MON-04 Actual temporal truth v1.
 *
 * CURRENT governed facts are resolved first:
 *
 * FULL CONTEXT
 * -> LINEAGE
 * -> CURRENT LEAVES
 * -> LIFECYCLE
 * -> NUMERIC DOMAIN
 * -> SEMANTIC AUTHORITY
 * -> COMPLETENESS
 *
 * Only then does this policy project the validated current leaves through the
 * inclusive Project Business Date cutoff. A correction may therefore restate
 * prior periods, while its superseded predecessor can never reappear.
 */
export function calculateActualTemporalOfficialQuantity<
  T extends Law1CalculationEntry,
>(
  input: Readonly<ActualTemporalOfficialQuantityInput<T>>,
): ActualTemporalOfficialQuantityResult {
  const governed = prepareActualTemporalOfficialQuantity(
    input.scope,
    input.entries,
  );
  return projectActualTemporalOfficialQuantity({
    governed,
    cutoffDate: input.cutoffDate,
  });
}

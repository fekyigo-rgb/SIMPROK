import { Prisma } from '@prisma/client';
import {
  resolveCurrentGovernedOfficialFacts,
  type CurrentOfficialQuantityResult,
  type Law1CalculationEntry,
} from './progress-current-official-quantity.policy';
import type { ProgressSemanticContextScope } from './progress-semantic-authority.policy';

export const ACTUAL_TEMPORAL_TRUTH_MODE =
  'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE' as const;

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

const PROJECT_BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const projectBusinessDateWire = (value: string): string | null => {
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

const workDateWire = (value: Date | null): string | null => {
  if (value === null || Number.isNaN(value.getTime())) return null;

  const wire = value.toISOString();
  const businessDate = wire.slice(0, 10);
  return wire === `${businessDate}T00:00:00.000Z`
    ? projectBusinessDateWire(businessDate)
    : null;
};

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
  if (projectBusinessDateWire(input.cutoffDate) === null) {
    return {
      state: 'UNAVAILABLE',
      reason: 'INVALID_PROJECT_BUSINESS_CUTOFF',
    };
  }

  const governed = resolveCurrentGovernedOfficialFacts(
    input.scope,
    input.entries,
  );

  switch (governed.state) {
    case 'NOT_YET_RECORDED':
    case 'NO_ELIGIBLE_CURRENT_FACT':
    case 'INVALID_LINEAGE':
    case 'INVALID_NUMERIC_FACT':
    case 'SEMANTICS_UNPROVEN':
      return governed;
    case 'INCOMPLETE':
    case 'COMPLETE':
      break;
  }

  let knownEligibleQuantitySubtotal = new Prisma.Decimal(0);
  let hasUnplaceableCurrentFact = false;

  for (const fact of governed.eligibleCurrentFacts) {
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

  if (governed.state === 'INCOMPLETE' || hasUnplaceableCurrentFact) {
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

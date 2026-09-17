import { Prisma } from '@prisma/client';
import type { CanonicalWorkPeriodAnchor } from '../project/work-period-anchor.policy';
import type { CurrentOfficialQuantityResult } from './progress-current-official-quantity.policy';
import { projectBusinessDateWire } from './progress-actual-temporal-quantity.policy';
import type { PlannedItemQuantityProjection } from './progress-period-window.policy';
import {
  canonicalWeekSlicesForMonth,
  resolveCanonicalTemporalPeriod,
  TEMPORAL_BASIS,
  TEMPORAL_GRANULARITY,
  type CanonicalTemporalPeriod,
  type CanonicalTemporalPeriodUnavailableReason,
  type TemporalBasis,
  type TemporalGranularity,
} from './progress-temporal-boundary.policy';

export const MONITORING_TEMPORAL_LENS_MODE =
  'CANONICAL_MONITORING_TEMPORAL_LENS_V1' as const;

export const TEMPORAL_LENS_WEEKLY_RECAP_RULE =
  'CANONICAL_WEEK_SLICE_RECAP' as const;

export type MonitoringTemporalLensInput = {
  basis: TemporalBasis;
  granularity: TemporalGranularity;
  referenceDate: string;
};

export type MonitoringTemporalLensQueryError =
  | 'AMBIGUOUS_TEMPORAL_LENS'
  | 'INVALID_INCLUDE_TEMPORAL_LENS'
  | 'TEMPORAL_LENS_FIELDS_REQUIRE_OPT_IN'
  | 'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE'
  | 'INVALID_TEMPORAL_BASIS'
  | 'INVALID_TEMPORAL_GRANULARITY'
  | 'INVALID_TEMPORAL_REFERENCE_PROJECT_BUSINESS_DATE'
  | 'TEMPORAL_LENS_EXPLICIT_PERIOD_WINDOW_CONFLICT'
  | 'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT';

export type MonitoringTemporalLensQueryResolution =
  | { state: 'DISABLED' }
  | { state: 'ENABLED'; input: MonitoringTemporalLensInput }
  | { state: 'INVALID'; reason: MonitoringTemporalLensQueryError };

export type MonitoringTemporalLensUnavailableReason =
  | CanonicalTemporalPeriodUnavailableReason
  | 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID';

export type MonitoringTemporalLensWeeklyRecap = {
  rule: typeof TEMPORAL_LENS_WEEKLY_RECAP_RULE;
  sliceCount: number;
  slices: Array<{
    weekPeriodKey: string;
    weekPeriodIndex: number;
    weekStartDate: string;
    weekEndDate: string;
    sliceStartDate: string;
    sliceEndDate: string;
  }>;
};

export type MonitoringTemporalLensBoundaryResolution =
  | {
      state: 'RESOLVED';
      period: CanonicalTemporalPeriod;
      weeklyRecap?: MonitoringTemporalLensWeeklyRecap;
    }
  | {
      state: 'UNAVAILABLE';
      reason: MonitoringTemporalLensUnavailableReason;
    };

const temporalLensQueryKeys = [
  'includeTemporalLens',
  'temporalBasis',
  'temporalGranularity',
  'temporalReferenceDate',
] as const;

export function parseMonitoringTemporalLensQuery(
  query: Readonly<Record<string, unknown>>,
): MonitoringTemporalLensQueryResolution {
  if (
    Object.keys(query).some((key) =>
      temporalLensQueryKeys.some((field) => key.startsWith(`${field}[`)),
    )
  ) {
    return { state: 'INVALID', reason: 'AMBIGUOUS_TEMPORAL_LENS' };
  }

  const includeValue = query.includeTemporalLens;
  if (includeValue !== undefined && typeof includeValue !== 'string') {
    return { state: 'INVALID', reason: 'AMBIGUOUS_TEMPORAL_LENS' };
  }
  if (
    includeValue !== undefined &&
    includeValue !== 'true' &&
    includeValue !== 'false'
  ) {
    return { state: 'INVALID', reason: 'INVALID_INCLUDE_TEMPORAL_LENS' };
  }

  const enabled = includeValue === 'true';
  const hasLensFields =
    query.temporalBasis !== undefined ||
    query.temporalGranularity !== undefined ||
    query.temporalReferenceDate !== undefined;
  if (!enabled) {
    return hasLensFields
      ? {
          state: 'INVALID',
          reason: 'TEMPORAL_LENS_FIELDS_REQUIRE_OPT_IN',
        }
      : { state: 'DISABLED' };
  }

  if (
    query.includePeriodWindow === 'true' ||
    query.periodStartDate !== undefined ||
    query.periodEndDate !== undefined
  ) {
    return {
      state: 'INVALID',
      reason: 'TEMPORAL_LENS_EXPLICIT_PERIOD_WINDOW_CONFLICT',
    };
  }
  if (
    query.cutoffDate !== undefined ||
    query.includeActualSeries === 'true' ||
    query.includeProgressComparison === 'true'
  ) {
    return {
      state: 'INVALID',
      reason: 'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT',
    };
  }

  if (
    query.temporalBasis === undefined ||
    query.temporalGranularity === undefined ||
    query.temporalReferenceDate === undefined
  ) {
    return {
      state: 'INVALID',
      reason: 'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE',
    };
  }
  if (
    typeof query.temporalBasis !== 'string' ||
    typeof query.temporalGranularity !== 'string' ||
    typeof query.temporalReferenceDate !== 'string'
  ) {
    return { state: 'INVALID', reason: 'AMBIGUOUS_TEMPORAL_LENS' };
  }
  if (!Object.values(TEMPORAL_BASIS).includes(query.temporalBasis as never)) {
    return { state: 'INVALID', reason: 'INVALID_TEMPORAL_BASIS' };
  }
  if (
    !Object.values(TEMPORAL_GRANULARITY).includes(
      query.temporalGranularity as never,
    )
  ) {
    return { state: 'INVALID', reason: 'INVALID_TEMPORAL_GRANULARITY' };
  }
  const referenceDate = projectBusinessDateWire(query.temporalReferenceDate);
  if (referenceDate === null) {
    return {
      state: 'INVALID',
      reason: 'INVALID_TEMPORAL_REFERENCE_PROJECT_BUSINESS_DATE',
    };
  }

  return {
    state: 'ENABLED',
    input: {
      basis: query.temporalBasis as TemporalBasis,
      granularity: query.temporalGranularity as TemporalGranularity,
      referenceDate,
    },
  };
}

export function resolveMonitoringTemporalLensBoundary(input: {
  temporalLens: MonitoringTemporalLensInput;
  governedWorkPeriodAnchor?: CanonicalWorkPeriodAnchor;
}): MonitoringTemporalLensBoundaryResolution {
  let governedWorkPeriodAnchorDate: string | undefined;
  if (input.temporalLens.basis === TEMPORAL_BASIS.WORK_PERIOD) {
    if (
      input.governedWorkPeriodAnchor === undefined ||
      input.governedWorkPeriodAnchor.state === 'NOT_PROVEN'
    ) {
      return {
        state: 'UNAVAILABLE',
        reason: 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
      };
    }
    if (input.governedWorkPeriodAnchor.state === 'INVALID_PROVENANCE') {
      return {
        state: 'UNAVAILABLE',
        reason: 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
      };
    }
    governedWorkPeriodAnchorDate = input.governedWorkPeriodAnchor.anchorDate;
  }

  const periodResolution = resolveCanonicalTemporalPeriod({
    ...input.temporalLens,
    governedWorkPeriodAnchorDate,
  });
  if (periodResolution.state === 'UNAVAILABLE') return periodResolution;
  if (input.temporalLens.granularity === TEMPORAL_GRANULARITY.WEEK) {
    return periodResolution;
  }

  const slicesResolution = canonicalWeekSlicesForMonth({
    basis: input.temporalLens.basis,
    referenceDate: input.temporalLens.referenceDate,
    governedWorkPeriodAnchorDate,
  });
  if (slicesResolution.state === 'UNAVAILABLE') return slicesResolution;

  return {
    state: 'RESOLVED',
    period: periodResolution.period,
    weeklyRecap: {
      rule: TEMPORAL_LENS_WEEKLY_RECAP_RULE,
      sliceCount: slicesResolution.slices.length,
      slices: slicesResolution.slices.map((slice) => ({
        weekPeriodKey: slice.week.periodKey,
        weekPeriodIndex: slice.week.periodIndex,
        weekStartDate: slice.week.startDate,
        weekEndDate: slice.week.endDate,
        sliceStartDate: slice.sliceStartDate,
        sliceEndDate: slice.sliceEndDate,
      })),
    },
  };
}

export function recapPlannedWeeklySlicePeriodQuantities(
  quantities: readonly PlannedItemQuantityProjection[],
): PlannedItemQuantityProjection {
  if (quantities.length === 0) {
    throw new Error('TEMPORAL_LENS_WEEK_SLICE_RECAP_REQUIRED');
  }
  const unavailable = quantities.find(
    (quantity) => quantity.state === 'UNAVAILABLE',
  );
  if (unavailable?.state === 'UNAVAILABLE') return unavailable;

  let subtotal = new Prisma.Decimal(0);
  let incompleteReason: string | null = null;
  for (const quantity of quantities) {
    if (quantity.state === 'COMPLETE') {
      subtotal = subtotal.plus(quantity.plannedQuantity);
    } else if (quantity.state === 'INCOMPLETE') {
      subtotal = subtotal.plus(quantity.knownPlannedQuantitySubtotal);
      incompleteReason ??= quantity.reason;
    }
  }

  return incompleteReason === null
    ? { state: 'COMPLETE', plannedQuantity: subtotal }
    : {
        state: 'INCOMPLETE',
        reason: incompleteReason,
        knownPlannedQuantitySubtotal: subtotal,
      };
}

export function recapActualWeeklySlicePeriodQuantities(
  quantities: readonly CurrentOfficialQuantityResult[],
): CurrentOfficialQuantityResult {
  if (quantities.length === 0) {
    throw new Error('TEMPORAL_LENS_WEEK_SLICE_RECAP_REQUIRED');
  }
  const terminal = quantities.find(
    (quantity) =>
      quantity.state !== 'COMPLETE' && quantity.state !== 'INCOMPLETE',
  );
  if (terminal !== undefined) return terminal;

  let subtotal = new Prisma.Decimal(0);
  let incomplete = false;
  for (const quantity of quantities) {
    if (quantity.state === 'COMPLETE') {
      subtotal = subtotal.plus(quantity.currentOfficialQuantity);
    } else if (quantity.state === 'INCOMPLETE') {
      subtotal = subtotal.plus(quantity.knownEligibleQuantitySubtotal);
      incomplete = true;
    }
  }

  return incomplete
    ? { state: 'INCOMPLETE', knownEligibleQuantitySubtotal: subtotal }
    : { state: 'COMPLETE', currentOfficialQuantity: subtotal };
}

import { Prisma } from '@prisma/client';
import type { CurrentOfficialRabWeightedPhysicalProgressResult } from './progress-current-rab-weighted-physical-progress.policy';

export const PROGRESS_COMPARISON_MODE =
  'PLANNED_VS_CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE' as const;

export const PROGRESS_COMPARISON_BOUNDARY_BASIS =
  'PLANNED_PERIOD_ENDS_AND_GOVERNED_ACTUAL_WORKDATES_AND_REQUESTED_CUTOFF' as const;

interface ProgressComparisonPlannedCurvePoint {
  periodEndDate: string;
  knownWeightedPlannedProgressPercent: string;
}

export type ProgressComparisonPlannedCurve =
  | {
      state: 'COMPLETE' | 'INCOMPLETE';
      reason: string | null;
      points: ProgressComparisonPlannedCurvePoint[];
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
      points: ProgressComparisonPlannedCurvePoint[];
    };

export type PlannedTemporalProgressResult =
  | {
      state: 'COMPLETE';
      plannedRabWeightedPhysicalProgressPercent: Prisma.Decimal;
    }
  | {
      state: 'INCOMPLETE';
      reason: string;
      knownWeightedPlannedProgressSubtotalPercent: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
    };

export type ProgressDeviationResult =
  | {
      state: 'COMPLETE';
      value: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason: {
        planned: 'PLANNED_INCOMPLETE' | 'PLANNED_UNAVAILABLE' | null;
        actual: 'ACTUAL_INCOMPLETE' | 'ACTUAL_UNAVAILABLE' | null;
      };
    };

const latestPlannedValueAt = (
  curve: ProgressComparisonPlannedCurve,
  boundaryDate: string,
): Prisma.Decimal => {
  const latest = curve.points.reduce<(typeof curve.points)[number] | null>(
    (candidate, point) =>
      point.periodEndDate <= boundaryDate &&
      (candidate === null || point.periodEndDate > candidate.periodEndDate)
        ? point
        : candidate,
    null,
  );

  return new Prisma.Decimal(latest?.knownWeightedPlannedProgressPercent ?? 0);
};

/**
 * Projects the canonical plannedCurve onto an arbitrary business-date
 * boundary. Full interval credit already belongs to plannedCurve only at its
 * inclusive periodEndDate; this projector therefore performs no plan math or
 * interpolation of its own.
 */
export function projectPlannedProgressAtBoundary(
  curve: ProgressComparisonPlannedCurve,
  boundaryDate: string,
): PlannedTemporalProgressResult {
  if (curve.state === 'UNAVAILABLE') {
    return { state: 'UNAVAILABLE', reason: curve.reason };
  }

  const value = latestPlannedValueAt(curve, boundaryDate);
  if (curve.state === 'INCOMPLETE') {
    if (curve.reason === null) {
      throw new Error('INCOMPLETE_PLANNED_CURVE_REASON_REQUIRED');
    }
    return {
      state: 'INCOMPLETE',
      reason: curve.reason,
      knownWeightedPlannedProgressSubtotalPercent: value,
    };
  }

  return {
    state: 'COMPLETE',
    plannedRabWeightedPhysicalProgressPercent: value,
  };
}

export function progressComparisonBoundaries(input: {
  plannedCurve: ProgressComparisonPlannedCurve;
  actualBoundaries: readonly string[];
  cutoffDate: string;
}): string[] {
  return Array.from(
    new Set([
      ...input.plannedCurve.points
        .map((point) => point.periodEndDate)
        .filter((date) => date <= input.cutoffDate),
      ...input.actualBoundaries.filter((date) => date <= input.cutoffDate),
      input.cutoffDate,
    ]),
  ).sort();
}

/** Actual minus Planned, in percentage points, only for two complete facts. */
export function calculateProgressDeviationPercentagePoints(
  planned: PlannedTemporalProgressResult,
  actual: CurrentOfficialRabWeightedPhysicalProgressResult,
): ProgressDeviationResult {
  if (planned.state === 'COMPLETE' && actual.state === 'COMPLETE') {
    return {
      state: 'COMPLETE',
      value: actual.currentOfficialRabWeightedPhysicalProgressPercent.sub(
        planned.plannedRabWeightedPhysicalProgressPercent,
      ),
    };
  }

  return {
    state: 'UNAVAILABLE',
    reason: {
      planned:
        planned.state === 'COMPLETE'
          ? null
          : planned.state === 'INCOMPLETE'
            ? 'PLANNED_INCOMPLETE'
            : 'PLANNED_UNAVAILABLE',
      actual:
        actual.state === 'COMPLETE'
          ? null
          : actual.state === 'INCOMPLETE'
            ? 'ACTUAL_INCOMPLETE'
            : 'ACTUAL_UNAVAILABLE',
    },
  };
}

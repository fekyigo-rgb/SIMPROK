import { Prisma } from '@prisma/client';
import type {
  MonitoringProjectWeight,
  MonitoringWeightFact,
  MonitoringWeightReason,
} from './monitoring-weight';
import type { WorkItemCurrentPhysicalProgressResult } from './progress-current-physical-progress.policy';

export interface CurrentRabWeightedPhysicalProgressWorkItemInput {
  boqItemId: string;
  rabWeight: MonitoringWeightFact;
  currentOfficialItemProgress: WorkItemCurrentPhysicalProgressResult;
}

export interface CurrentRabWeightedPhysicalProgressInput {
  projectWeight: MonitoringProjectWeight;
  workItems: readonly CurrentRabWeightedPhysicalProgressWorkItemInput[];
}

export type CurrentOfficialRabWeightedPhysicalProgressResult =
  | {
      state: 'COMPLETE';
      currentOfficialRabWeightedPhysicalProgressPercent: Prisma.Decimal;
    }
  | {
      state: 'INCOMPLETE';
      knownWeightedContributionSubtotalPercent: Prisma.Decimal;
    }
  | {
      state: 'UNAVAILABLE';
      reason: MonitoringWeightReason;
    };

const invariant = (message: string): never => {
  throw new Error(message);
};

const availableWeight = (
  fact: Extract<MonitoringWeightFact, { state: 'AVAILABLE' }>,
) => {
  let weight: Prisma.Decimal;

  try {
    weight = new Prisma.Decimal(fact.percentage);
  } catch {
    return invariant('H2A1_AVAILABLE_WEIGHT_INVALID');
  }

  if (
    weight.isNaN() ||
    !weight.isFinite() ||
    weight.isNegative() ||
    weight.greaterThan(100)
  ) {
    return invariant('H2A1_AVAILABLE_WEIGHT_INVALID');
  }

  return weight;
};

/**
 * Owner-ratified MON-04 LAW 3 project aggregation.
 *
 * H2-A1 exclusively owns RAB weights. LAW 2 exclusively owns bounded item
 * progress. This policy consumes those already-proven facts for canonical
 * WORK_ITEMs and performs no quantity, progress, weight, or persistence work.
 *
 * WEIGHTED CONTRIBUTION PERCENT = RAB WEIGHT PERCENT
 *   x BOUNDED CONTRIBUTION PROGRESS PERCENT / 100
 *
 * Known contributions remain on the canonical project denominator. They are
 * never renormalized, rounded per item, or mislabeled as complete progress.
 */
export function calculateCurrentOfficialRabWeightedPhysicalProgress(
  input: Readonly<CurrentRabWeightedPhysicalProgressInput>,
): CurrentOfficialRabWeightedPhysicalProgressResult {
  if (input.projectWeight.completeness === 'UNAVAILABLE') {
    if (input.projectWeight.reason === null) {
      return invariant('H2A1_PROJECT_UNAVAILABLE_REASON_REQUIRED');
    }

    return {
      state: 'UNAVAILABLE',
      reason: input.projectWeight.reason,
    };
  }

  let knownWeightedContributionSubtotalPercent = new Prisma.Decimal(0);
  let unresolvedResultChangingTruth =
    input.projectWeight.completeness === 'INCOMPLETE';

  for (const workItem of input.workItems) {
    if (workItem.rabWeight.state !== 'AVAILABLE') {
      if (input.projectWeight.completeness === 'COMPLETE') {
        return invariant('H2A1_COMPLETE_WORK_ITEM_WEIGHT_REQUIRED');
      }

      unresolvedResultChangingTruth = true;
      continue;
    }

    const weight = availableWeight(workItem.rabWeight);

    // Exact AVAILABLE zero weight contributes zero without rewriting the
    // independently truthful LAW 1 / LAW 2 physical state.
    if (weight.isZero()) continue;

    if (workItem.currentOfficialItemProgress.state !== 'COMPLETE') {
      unresolvedResultChangingTruth = true;
      continue;
    }

    knownWeightedContributionSubtotalPercent =
      knownWeightedContributionSubtotalPercent.add(
        weight
          .mul(
            workItem.currentOfficialItemProgress
              .boundedContributionProgressPercent,
          )
          .div(100),
      );
  }

  if (unresolvedResultChangingTruth) {
    return {
      state: 'INCOMPLETE',
      knownWeightedContributionSubtotalPercent,
    };
  }

  return {
    state: 'COMPLETE',
    currentOfficialRabWeightedPhysicalProgressPercent:
      knownWeightedContributionSubtotalPercent,
  };
}

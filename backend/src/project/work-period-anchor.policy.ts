import { ProgressAuditOutcome } from '@prisma/client';
import {
  projectBusinessDateWire,
  workDateWire,
} from '../progress/progress-actual-temporal-quantity.policy';
import type {
  CurrentGovernedOfficialFactsResult,
  Law1CalculationEntry,
} from '../progress/progress-current-official-quantity.policy';

export const WORK_PERIOD_ANCHOR_POLICY_VERSION =
  'MON04_WORK_PERIOD_ANCHOR_V1' as const;

export const WORK_PERIOD_ANCHOR_ACTION = {
  ACTIVATED: 'PROJECT_WORK_PERIOD_ANCHOR_ACTIVATED',
  CONFIRMED: 'PROJECT_WORK_PERIOD_ANCHOR_CONFIRMED',
} as const;

export type WorkPeriodAnchorAction =
  (typeof WORK_PERIOD_ANCHOR_ACTION)[keyof typeof WORK_PERIOD_ANCHOR_ACTION];

export interface WorkPeriodAnchorProofMetadata {
  policyVersion: typeof WORK_PERIOD_ANCHOR_POLICY_VERSION;
  anchorDate: string;
  previousStartDate: string | null;
  actorAssignmentId: string;
  explicitConfirmation: true;
}

export interface WorkPeriodAnchorAuditCandidate {
  id: string;
  projectId: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  action: string;
  outcome: ProgressAuditOutcome;
  actorAccountId: string;
  actorMembershipId: string;
  reason: string | null;
  metadata: unknown;
  occurredAt: Date;
}

export type CanonicalWorkPeriodAnchor =
  | {
      state: 'NOT_PROVEN';
      anchorDate: null;
      candidateDate: string | null;
      provenance: null;
    }
  | {
      state: 'INVALID_PROVENANCE';
      anchorDate: null;
      candidateDate: string | null;
      provenance: null;
      reason:
        | 'GOVERNANCE_PROOF_INVALID'
        | 'CONFLICTING_GOVERNANCE_PROOFS'
        | 'GOVERNED_ANCHOR_START_DATE_MISMATCH';
    }
  | {
      state: 'PROVEN';
      anchorDate: string;
      candidateDate: string;
      provenance: {
        eventId: string;
        action: WorkPeriodAnchorAction;
        actorAccountId: string;
        actorMembershipId: string;
        actorAssignmentId: string;
        occurredAt: string;
        reason: string | null;
      };
    };

const isAnchorAction = (value: string): value is WorkPeriodAnchorAction =>
  value === WORK_PERIOD_ANCHOR_ACTION.ACTIVATED ||
  value === WORK_PERIOD_ANCHOR_ACTION.CONFIRMED;

const proofMetadata = (
  value: unknown,
): WorkPeriodAnchorProofMetadata | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (
    metadata.policyVersion !== WORK_PERIOD_ANCHOR_POLICY_VERSION ||
    projectBusinessDateWire(metadata.anchorDate) === null ||
    (metadata.previousStartDate !== null &&
      typeof metadata.previousStartDate !== 'string') ||
    typeof metadata.actorAssignmentId !== 'string' ||
    metadata.explicitConfirmation !== true
  ) {
    return null;
  }
  return metadata as unknown as WorkPeriodAnchorProofMetadata;
};

export function readCanonicalWorkPeriodAnchor(input: {
  projectId: string;
  startDate: Date | null;
  events: readonly WorkPeriodAnchorAuditCandidate[];
}): CanonicalWorkPeriodAnchor {
  const candidateDate = workDateWire(input.startDate);

  if (input.events.length === 0) {
    return {
      state: 'NOT_PROVEN',
      anchorDate: null,
      candidateDate,
      provenance: null,
    };
  }

  const parsed = input.events.map((event) => ({
    event,
    metadata: proofMetadata(event.metadata),
  }));
  if (
    parsed.some(
      ({ event, metadata }) =>
        event.projectId !== input.projectId ||
        event.targetEntityType !== 'PROJECT' ||
        event.targetEntityId !== input.projectId ||
        event.outcome !== ProgressAuditOutcome.SUCCESS ||
        !isAnchorAction(event.action) ||
        metadata === null,
    )
  ) {
    return {
      state: 'INVALID_PROVENANCE',
      anchorDate: null,
      candidateDate,
      provenance: null,
      reason: 'GOVERNANCE_PROOF_INVALID',
    };
  }

  const anchors = new Set(parsed.map(({ metadata }) => metadata!.anchorDate));
  if (anchors.size !== 1) {
    return {
      state: 'INVALID_PROVENANCE',
      anchorDate: null,
      candidateDate,
      provenance: null,
      reason: 'CONFLICTING_GOVERNANCE_PROOFS',
    };
  }

  const anchorDate = parsed[0].metadata!.anchorDate;
  if (candidateDate !== anchorDate) {
    return {
      state: 'INVALID_PROVENANCE',
      anchorDate: null,
      candidateDate,
      provenance: null,
      reason: 'GOVERNED_ANCHOR_START_DATE_MISMATCH',
    };
  }

  const latest = parsed.at(-1)!;
  return {
    state: 'PROVEN',
    anchorDate,
    candidateDate: anchorDate,
    provenance: {
      eventId: latest.event.id,
      action: latest.event.action as WorkPeriodAnchorAction,
      actorAccountId: latest.event.actorAccountId,
      actorMembershipId: latest.event.actorMembershipId,
      actorAssignmentId: latest.metadata!.actorAssignmentId,
      occurredAt: latest.event.occurredAt.toISOString(),
      reason: latest.event.reason,
    },
  };
}

export type WorkPeriodAnchorCompatibility =
  | { state: 'COMPATIBLE' }
  | {
      state: 'CONFLICT';
      code:
        | 'WORK_PERIOD_ANCHOR_PLANNED_FACT_BEFORE_ANCHOR'
        | 'WORK_PERIOD_ANCHOR_ACTUAL_FACT_BEFORE_ANCHOR';
      baselineId: string;
      boqItemId: string;
      earliestConflictingDate: string;
      executionPlanVersionId?: string;
    }
  | {
      state: 'UNPROVEN';
      code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN';
      source: 'PLANNED' | 'ACTUAL';
      reason: string;
      boqItemId?: string;
    };

export type PlannedAnchorCompatibilityContext =
  | { state: 'NO_LOCKED_PLAN' }
  | { state: 'UNPROVEN'; reason: string }
  | {
      state: 'AUTHORITATIVE';
      baselineId: string;
      executionPlanVersionId: string;
      distributions: readonly {
        boqItemId: string;
        periodEndDate: Date;
      }[];
    };

export function assessPlannedAnchorCompatibility(
  anchorDate: string,
  context: PlannedAnchorCompatibilityContext,
): WorkPeriodAnchorCompatibility {
  if (context.state === 'NO_LOCKED_PLAN') return { state: 'COMPATIBLE' };
  if (context.state === 'UNPROVEN') {
    return {
      state: 'UNPROVEN',
      code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
      source: 'PLANNED',
      reason: context.reason,
    };
  }

  let conflict:
    | { boqItemId: string; earliestConflictingDate: string }
    | undefined;
  for (const distribution of context.distributions) {
    const creditDate = workDateWire(distribution.periodEndDate);
    if (creditDate === null) {
      return {
        state: 'UNPROVEN',
        code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
        source: 'PLANNED',
        reason: 'INVALID_DISTRIBUTION_DATE',
        boqItemId: distribution.boqItemId,
      };
    }
    if (
      creditDate < anchorDate &&
      (!conflict || creditDate < conflict.earliestConflictingDate)
    ) {
      conflict = {
        boqItemId: distribution.boqItemId,
        earliestConflictingDate: creditDate,
      };
    }
  }

  return conflict
    ? {
        state: 'CONFLICT',
        code: 'WORK_PERIOD_ANCHOR_PLANNED_FACT_BEFORE_ANCHOR',
        baselineId: context.baselineId,
        executionPlanVersionId: context.executionPlanVersionId,
        ...conflict,
      }
    : { state: 'COMPATIBLE' };
}

export function assessActualAnchorCompatibility(input: {
  anchorDate: string;
  baselineId: string;
  contexts: readonly {
    boqItemId: string;
    governed: CurrentGovernedOfficialFactsResult<Law1CalculationEntry>;
  }[];
}): WorkPeriodAnchorCompatibility {
  let conflict:
    | { boqItemId: string; earliestConflictingDate: string }
    | undefined;

  for (const context of input.contexts) {
    switch (context.governed.state) {
      case 'NOT_YET_RECORDED':
      case 'NO_ELIGIBLE_CURRENT_FACT':
        continue;
      case 'INVALID_LINEAGE':
      case 'INVALID_NUMERIC_FACT':
      case 'SEMANTICS_UNPROVEN':
      case 'INCOMPLETE':
        return {
          state: 'UNPROVEN',
          code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
          source: 'ACTUAL',
          reason: context.governed.state,
          boqItemId: context.boqItemId,
        };
      case 'COMPLETE':
        break;
    }

    for (const fact of context.governed.eligibleCurrentFacts) {
      const factDate = workDateWire(fact.entry.workDate);
      if (factDate === null) {
        return {
          state: 'UNPROVEN',
          code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
          source: 'ACTUAL',
          reason: 'UNPLACEABLE_CURRENT_WORK_DATE',
          boqItemId: context.boqItemId,
        };
      }
      if (
        factDate < input.anchorDate &&
        (!conflict || factDate < conflict.earliestConflictingDate)
      ) {
        conflict = {
          boqItemId: context.boqItemId,
          earliestConflictingDate: factDate,
        };
      }
    }
  }

  return conflict
    ? {
        state: 'CONFLICT',
        code: 'WORK_PERIOD_ANCHOR_ACTUAL_FACT_BEFORE_ANCHOR',
        baselineId: input.baselineId,
        ...conflict,
      }
    : { state: 'COMPATIBLE' };
}

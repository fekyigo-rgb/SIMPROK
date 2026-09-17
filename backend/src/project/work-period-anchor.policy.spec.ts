import { ProgressActualStatus, ProgressAuditOutcome } from '@prisma/client';
import { PROGRESS_AUTHORITIES } from '../progress/progress-authority.service';
import { prepareActualTemporalOfficialQuantity } from '../progress/progress-actual-temporal-quantity.policy';
import type { Law1CalculationEntry } from '../progress/progress-current-official-quantity.policy';
import {
  createProgressSemanticVerificationContext,
  MON04_SEMANTIC_AUDIT_ACTION,
  progressSemanticProofMetadata,
  type ProgressSemanticContextScope,
} from '../progress/progress-semantic-authority.policy';
import {
  WORK_PERIOD_ANCHOR_ACTION,
  WORK_PERIOD_ANCHOR_POLICY_VERSION,
  assessActualAnchorCompatibility,
  assessActualPromotionAnchorCompatibility,
  assessPlannedAnchorCompatibility,
  readCanonicalWorkPeriodAnchor,
  type WorkPeriodAnchorAuditCandidate,
} from './work-period-anchor.policy';

describe('MON-04 governed Work Period anchor policy', () => {
  const projectId = 'project-anchor';
  const baselineId = 'baseline-anchor';
  const boqItemId = 'boq-anchor';
  const scope: ProgressSemanticContextScope = {
    projectId,
    activeBaselineId: baselineId,
    boqItemId,
  };
  const businessDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const proof = (
    anchorDate = '2026-05-18',
    overrides: Partial<WorkPeriodAnchorAuditCandidate> = {},
  ): WorkPeriodAnchorAuditCandidate => ({
    id: 'anchor-event-1',
    projectId,
    targetEntityType: 'PROJECT',
    targetEntityId: projectId,
    action: WORK_PERIOD_ANCHOR_ACTION.ACTIVATED,
    outcome: ProgressAuditOutcome.SUCCESS,
    actorAccountId: 'actor-anchor',
    actorMembershipId: 'membership-anchor',
    reason: 'Owner confirmation',
    metadata: {
      policyVersion: WORK_PERIOD_ANCHOR_POLICY_VERSION,
      anchorDate,
      previousStartDate: null,
      actorAssignmentId: 'assignment-anchor',
      explicitConfirmation: true,
    },
    occurredAt: new Date('2026-09-17T00:00:00.000Z'),
    ...overrides,
  });

  const entry = (
    id: string,
    workDate: string | null,
    overrides: Partial<Law1CalculationEntry> = {},
  ): Law1CalculationEntry => ({
    id,
    supersedesEntryId: null,
    installedQuantity: '1',
    workDate: workDate === null ? null : businessDate(workDate),
    status: ProgressActualStatus.VERIFIED,
    captureMethod: 'FIELD_MEASUREMENT',
    evidenceReferences: [],
    notes: null,
    correctionReasonCode: null,
    correctionReason: null,
    recordedByAccountId: 'actor-anchor',
    revision: 1,
    auditEvents: [],
    ...overrides,
  });

  const govern = (
    entries: readonly Law1CalculationEntry[],
    provenLeafIds?: readonly string[],
  ): Law1CalculationEntry[] => {
    const context = createProgressSemanticVerificationContext(scope, entries);
    if (context.state !== 'VALID') throw new Error('VALID_CONTEXT_REQUIRED');
    const ids = new Set(provenLeafIds ?? context.currentLeafIds);
    const metadata = progressSemanticProofMetadata(context);
    return entries.map((candidate) =>
      ids.has(candidate.id)
        ? {
            ...candidate,
            auditEvents: [
              ...candidate.auditEvents,
              {
                action: MON04_SEMANTIC_AUDIT_ACTION,
                outcome: ProgressAuditOutcome.SUCCESS,
                occurredAt: new Date('2026-09-17T01:00:00.000Z'),
                actorAccountId: 'actor-verifier',
                authorityCode: PROGRESS_AUTHORITIES.VERIFY,
                metadata,
              },
            ],
          }
        : candidate,
    );
  };

  it('keeps null and legacy Project.startDate NOT_PROVEN without proof', () => {
    expect(
      readCanonicalWorkPeriodAnchor({ projectId, startDate: null, events: [] }),
    ).toEqual({
      state: 'NOT_PROVEN',
      anchorDate: null,
      candidateDate: null,
      provenance: null,
    });
    expect(
      readCanonicalWorkPeriodAnchor({
        projectId,
        startDate: businessDate('2026-05-18'),
        events: [],
      }),
    ).toEqual({
      state: 'NOT_PROVEN',
      anchorDate: null,
      candidateDate: '2026-05-18',
      provenance: null,
    });
  });

  it('does not expose a malformed/non-midnight legacy DateTime as candidate truth', () => {
    expect(
      readCanonicalWorkPeriodAnchor({
        projectId,
        startDate: new Date('2026-05-18T12:00:00.000Z'),
        events: [],
      }),
    ).toEqual({
      state: 'NOT_PROVEN',
      anchorDate: null,
      candidateDate: null,
      provenance: null,
    });
  });

  it('returns PROVEN only when valid proof matches the exact stored date', () => {
    expect(
      readCanonicalWorkPeriodAnchor({
        projectId,
        startDate: businessDate('2026-05-18'),
        events: [proof()],
      }),
    ).toEqual({
      state: 'PROVEN',
      anchorDate: '2026-05-18',
      candidateDate: '2026-05-18',
      provenance: {
        eventId: 'anchor-event-1',
        action: WORK_PERIOD_ANCHOR_ACTION.ACTIVATED,
        actorAccountId: 'actor-anchor',
        actorMembershipId: 'membership-anchor',
        actorAssignmentId: 'assignment-anchor',
        occurredAt: '2026-09-17T00:00:00.000Z',
        reason: 'Owner confirmation',
      },
    });
  });

  it('fails closed when proof and Project.startDate mismatch or proofs conflict', () => {
    expect(
      readCanonicalWorkPeriodAnchor({
        projectId,
        startDate: businessDate('2026-05-19'),
        events: [proof()],
      }),
    ).toMatchObject({
      state: 'INVALID_PROVENANCE',
      anchorDate: null,
      reason: 'GOVERNED_ANCHOR_START_DATE_MISMATCH',
    });
    expect(
      readCanonicalWorkPeriodAnchor({
        projectId,
        startDate: businessDate('2026-05-18'),
        events: [
          proof(),
          proof('2026-05-19', {
            id: 'anchor-event-2',
            action: WORK_PERIOD_ANCHOR_ACTION.CONFIRMED,
          }),
        ],
      }),
    ).toMatchObject({
      state: 'INVALID_PROVENANCE',
      reason: 'CONFLICTING_GOVERNANCE_PROOFS',
    });
  });

  it('uses only canonical distribution periodEndDate for Planned compatibility', () => {
    expect(
      assessPlannedAnchorCompatibility('2026-05-18', {
        state: 'AUTHORITATIVE',
        baselineId,
        executionPlanVersionId: 'plan-anchor',
        distributions: [
          { boqItemId, periodEndDate: businessDate('2026-05-18') },
          { boqItemId: 'boq-later', periodEndDate: businessDate('2026-06-01') },
        ],
      }),
    ).toEqual({ state: 'COMPATIBLE' });
    expect(
      assessPlannedAnchorCompatibility('2026-05-18', {
        state: 'AUTHORITATIVE',
        baselineId,
        executionPlanVersionId: 'plan-anchor',
        distributions: [
          { boqItemId, periodEndDate: businessDate('2026-05-17') },
        ],
      }),
    ).toEqual({
      state: 'CONFLICT',
      code: 'WORK_PERIOD_ANCHOR_PLANNED_FACT_BEFORE_ANCHOR',
      baselineId,
      executionPlanVersionId: 'plan-anchor',
      boqItemId,
      earliestConflictingDate: '2026-05-17',
    });
    expect(
      assessPlannedAnchorCompatibility('2026-05-18', {
        state: 'NO_LOCKED_PLAN',
      }),
    ).toEqual({ state: 'COMPATIBLE' });
  });

  it('fails Planned compatibility closed for ambiguous authority', () => {
    expect(
      assessPlannedAnchorCompatibility('2026-05-18', {
        state: 'UNPROVEN',
        reason: 'BASELINE_BINDING_MISMATCH',
      }),
    ).toEqual({
      state: 'UNPROVEN',
      code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
      source: 'PLANNED',
      reason: 'BASELINE_BINDING_MISMATCH',
    });
  });

  it('uses current governed Actual leaves and never resurrects a corrected predecessor', () => {
    const movedOut = govern([
      entry('original-before', '2026-05-05'),
      entry('correction-after', '2026-05-20', {
        supersedesEntryId: 'original-before',
        revision: 2,
      }),
    ]);
    expect(
      assessActualAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        contexts: [
          {
            boqItemId,
            governed: prepareActualTemporalOfficialQuantity(scope, movedOut),
          },
        ],
      }),
    ).toEqual({ state: 'COMPATIBLE' });

    const movedIn = govern([
      entry('original-after', '2026-05-20'),
      entry('correction-before', '2026-05-05', {
        supersedesEntryId: 'original-after',
        revision: 2,
      }),
    ]);
    expect(
      assessActualAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        contexts: [
          {
            boqItemId,
            governed: prepareActualTemporalOfficialQuantity(scope, movedIn),
          },
        ],
      }),
    ).toEqual({
      state: 'CONFLICT',
      code: 'WORK_PERIOD_ANCHOR_ACTUAL_FACT_BEFORE_ANCHOR',
      baselineId,
      boqItemId,
      earliestConflictingDate: '2026-05-05',
    });
  });

  it('allows no Actual and exact-anchor current facts but propagates uncertainty', () => {
    expect(
      assessActualAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        contexts: [
          {
            boqItemId,
            governed: prepareActualTemporalOfficialQuantity(scope, []),
          },
        ],
      }),
    ).toEqual({ state: 'COMPATIBLE' });

    const exact = govern([entry('exact', '2026-05-18')]);
    expect(
      assessActualAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        contexts: [
          {
            boqItemId,
            governed: prepareActualTemporalOfficialQuantity(scope, exact),
          },
        ],
      }),
    ).toEqual({ state: 'COMPATIBLE' });

    expect(
      assessActualAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        contexts: [
          {
            boqItemId,
            governed: prepareActualTemporalOfficialQuantity(scope, [
              entry('unproven', '2026-05-20'),
            ]),
          },
        ],
      }),
    ).toEqual({
      state: 'UNPROVEN',
      code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
      source: 'ACTUAL',
      reason: 'SEMANTICS_UNPROVEN',
      boqItemId,
    });
  });

  it('gates only the exact current leaf workDate at Actual semantic promotion', () => {
    expect(
      assessActualPromotionAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        boqItemId,
        workDate: businessDate('2026-05-20'),
      }),
    ).toEqual({ state: 'COMPATIBLE' });
    expect(
      assessActualPromotionAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        boqItemId,
        workDate: businessDate('2026-05-18'),
      }),
    ).toEqual({ state: 'COMPATIBLE' });
    expect(
      assessActualPromotionAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        boqItemId,
        workDate: businessDate('2026-05-17'),
      }),
    ).toEqual({
      state: 'CONFLICT',
      code: 'WORK_PERIOD_ANCHOR_ACTUAL_FACT_BEFORE_ANCHOR',
      baselineId,
      boqItemId,
      earliestConflictingDate: '2026-05-17',
    });
    expect(
      assessActualPromotionAnchorCompatibility({
        anchorDate: '2026-05-18',
        baselineId,
        boqItemId,
        workDate: null,
      }),
    ).toEqual({
      state: 'UNPROVEN',
      code: 'WORK_PERIOD_ANCHOR_COMPATIBILITY_UNPROVEN',
      source: 'ACTUAL',
      reason: 'UNPLACEABLE_CURRENT_WORK_DATE',
      boqItemId,
    });
  });
});

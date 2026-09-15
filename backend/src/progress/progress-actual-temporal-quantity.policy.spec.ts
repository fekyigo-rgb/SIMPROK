import {
  Prisma,
  ProgressActualStatus,
  ProgressAuditOutcome,
} from '@prisma/client';
import {
  ACTUAL_TEMPORAL_TRUTH_MODE,
  calculateActualTemporalOfficialQuantity,
} from './progress-actual-temporal-quantity.policy';
import type {
  CurrentOfficialQuantityResult,
  Law1CalculationEntry,
} from './progress-current-official-quantity.policy';
import { calculateWorkItemCurrentPhysicalProgress } from './progress-current-physical-progress.policy';
import { calculateCurrentOfficialRabWeightedPhysicalProgress } from './progress-current-rab-weighted-physical-progress.policy';
import {
  createProgressSemanticVerificationContext,
  MON04_SEMANTIC_AUDIT_ACTION,
  progressSemanticProofMetadata,
  type ProgressSemanticContextScope,
} from './progress-semantic-authority.policy';
import { PROGRESS_AUTHORITIES } from './progress-authority.service';
import { MONITORING_WEIGHT_BASIS } from './monitoring-weight';

describe('MON-04 Actual temporal quantity v1', () => {
  const scope: ProgressSemanticContextScope = {
    projectId: 'project-1',
    activeBaselineId: 'baseline-1',
    boqItemId: 'item-1',
  };

  const businessDate = (value: string) => new Date(value + 'T00:00:00.000Z');

  const entry = (
    id: string,
    quantity: string,
    workDate: string | null,
    overrides: Partial<Law1CalculationEntry> = {},
  ): Law1CalculationEntry => ({
    id,
    supersedesEntryId: null,
    installedQuantity: quantity,
    workDate: workDate === null ? null : businessDate(workDate),
    status: ProgressActualStatus.VERIFIED,
    captureMethod: 'FIELD_MEASUREMENT',
    evidenceReferences: [],
    notes: null,
    correctionReasonCode: null,
    correctionReason: null,
    recordedByAccountId: 'actor-1',
    revision: 1,
    auditEvents: [],
    ...overrides,
  });

  const prove = (
    entries: readonly Law1CalculationEntry[],
    leafIds?: readonly string[],
    occurredAt = new Date('2026-09-15T12:00:00.000Z'),
  ): Law1CalculationEntry[] => {
    const context = createProgressSemanticVerificationContext(scope, entries);
    if (context.state !== 'VALID') throw new Error('VALID_CONTEXT_REQUIRED');

    const ids = new Set(leafIds ?? context.currentLeafIds);
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
                occurredAt,
                actorAccountId: 'actor-verify',
                authorityCode: PROGRESS_AUTHORITIES.VERIFY,
                metadata,
              },
            ],
          }
        : candidate,
    );
  };

  const project = (
    entries: readonly Law1CalculationEntry[],
    cutoffDate: string,
    requestedScope = scope,
  ) =>
    calculateActualTemporalOfficialQuantity({
      scope: requestedScope,
      entries,
      cutoffDate,
    });

  const completeQuantity = (
    result: ReturnType<typeof calculateActualTemporalOfficialQuantity>,
  ): Extract<CurrentOfficialQuantityResult, { state: 'COMPLETE' }> => {
    if (result.state !== 'COMPLETE') {
      throw new Error('COMPLETE_TEMPORAL_QUANTITY_REQUIRED');
    }
    return result;
  };

  it('declares the ratified restated-current-truth mode', () => {
    expect(ACTUAL_TEMPORAL_TRUTH_MODE).toBe(
      'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE',
    );
  });

  it('includes VERIFIED and ACCEPTED current leaves through the cutoff', () => {
    const verified = prove([entry('verified', '4', '2026-09-05')]);
    const accepted = prove([
      entry('accepted', '5', '2026-09-05', {
        status: ProgressActualStatus.ACCEPTED,
      }),
    ]);

    expect(project(verified, '2026-09-07')).toMatchObject({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal(4),
    });
    expect(project(accepted, '2026-09-07')).toMatchObject({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal(5),
    });
  });

  it('keeps a SUBMITTED current leaf non-official', () => {
    expect(
      project(
        [
          entry('submitted', '4', '2026-09-05', {
            status: ProgressActualStatus.SUBMITTED,
          }),
        ],
        '2026-09-07',
      ),
    ).toEqual({ state: 'NO_ELIGIBLE_CURRENT_FACT' });
  });

  it('never resurrects a superseded VERIFIED predecessor', () => {
    const predecessor = entry('r1', '10', '2026-09-05');
    const historicallyProven = prove([predecessor]);
    const successor = entry('r2', '8', '2026-09-09', {
      supersedesEntryId: 'r1',
      status: ProgressActualStatus.SUBMITTED,
      revision: 2,
    });

    expect(project([...historicallyProven, successor], '2026-09-07')).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });
  });

  it('restates a corrected quantity onto the successor same workDate', () => {
    const current = prove([
      entry('r1', '10', '2026-09-05'),
      entry('r2', '8', '2026-09-05', {
        supersedesEntryId: 'r1',
        revision: 2,
      }),
    ]);

    const result = project(current, '2026-09-07');
    expect(result.state).toBe('COMPLETE');
    if (result.state === 'COMPLETE') {
      expect(result.currentOfficialQuantity.toString()).toBe('8');
    }
  });

  it('moves restated history with the current correction workDate', () => {
    const movedLater = prove([
      entry('later-r1', '10', '2026-09-05'),
      entry('later-r2', '8', '2026-09-09', {
        supersedesEntryId: 'later-r1',
        revision: 2,
      }),
    ]);
    const movedEarlier = prove([
      entry('earlier-r1', '10', '2026-09-09'),
      entry('earlier-r2', '8', '2026-09-03', {
        supersedesEntryId: 'earlier-r1',
        revision: 2,
      }),
    ]);

    expect(
      completeQuantity(
        project(movedLater, '2026-09-07'),
      ).currentOfficialQuantity.toString(),
    ).toBe('0');
    expect(
      completeQuantity(
        project(movedEarlier, '2026-09-07'),
      ).currentOfficialQuantity.toString(),
    ).toBe('8');
  });

  it('restates late verification and semantic proof to workDate', () => {
    const lateProof = prove(
      [entry('late', '6', '2026-09-05')],
      undefined,
      new Date('2026-09-12T10:00:00.000Z'),
    );

    expect(
      completeQuantity(
        project(lateProof, '2026-09-07'),
      ).currentOfficialQuantity.toString(),
    ).toBe('6');
  });

  it('keeps missing distinct from a proven numeric zero', () => {
    const provenZero = prove([entry('zero', '0', '2026-09-05')]);

    expect(project([], '2026-09-07')).toEqual({
      state: 'NOT_YET_RECORDED',
    });
    expect(
      completeQuantity(
        project(provenZero, '2026-09-07'),
      ).currentOfficialQuantity.toString(),
    ).toBe('0');
  });

  it('keeps semantic and lineage failures unresolved', () => {
    expect(
      project([entry('unproven', '4', '2026-09-05')], '2026-09-07'),
    ).toEqual({ state: 'SEMANTICS_UNPROVEN' });

    const cycleA = entry('cycle-a', '1', '2026-09-05', {
      supersedesEntryId: 'cycle-b',
    });
    const cycleB = entry('cycle-b', '2', '2026-09-05', {
      supersedesEntryId: 'cycle-a',
    });
    expect(project([cycleA, cycleB], '2026-09-07')).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
    });
  });

  it('keeps a known temporal subtotal diagnostic when current truth is incomplete', () => {
    const eligible = entry('eligible', '3', '2026-09-05');
    const submitted = entry('submitted-root', '4', '2026-09-06', {
      status: ProgressActualStatus.SUBMITTED,
    });
    const current = prove([eligible, submitted], ['eligible']);
    const result = project(current, '2026-09-07');

    expect(result.state).toBe('INCOMPLETE');
    if (result.state === 'INCOMPLETE') {
      expect(result.knownEligibleQuantitySubtotal.toString()).toBe('3');
    }
  });

  it('does not place an eligible fact whose Project Business workDate is missing', () => {
    const current = prove([entry('undated', '3', null)]);
    const result = project(current, '2026-09-07');

    expect(result.state).toBe('INCOMPLETE');
    if (result.state === 'INCOMPLETE') {
      expect(result.knownEligibleQuantitySubtotal.toString()).toBe('0');
    }
  });

  it('projects multiple independent lineages deterministically across cutoffs', () => {
    const current = prove([
      entry('root-a', '3', '2026-09-05'),
      entry('root-b', '4', '2026-09-09'),
    ]);
    const quantityAt = (cutoffDate: string) =>
      completeQuantity(
        project(current, cutoffDate),
      ).currentOfficialQuantity.toString();

    expect(quantityAt('2026-09-04')).toBe('0');
    expect(quantityAt('2026-09-05')).toBe('3');
    expect(quantityAt('2026-09-08')).toBe('3');
    expect(quantityAt('2026-09-09')).toBe('7');
    expect(quantityAt('2026-09-09')).toBe('7');
  });

  it('binds semantic proof to project, Active Baseline, and WORK_ITEM scope', () => {
    const current = prove([entry('scoped', '4', '2026-09-05')]);
    const mismatches: ProgressSemanticContextScope[] = [
      { ...scope, projectId: 'project-foreign' },
      { ...scope, activeBaselineId: 'baseline-foreign' },
      { ...scope, boqItemId: 'item-foreign' },
    ];

    for (const requestedScope of mismatches) {
      expect(project(current, '2026-09-07', requestedScope)).toEqual({
        state: 'SEMANTICS_UNPROVEN',
      });
    }
  });

  it('uses exact Decimal accumulation without intermediate Number arithmetic', () => {
    const current = prove([
      entry('decimal-a', '0.1', '2026-09-05'),
      entry('decimal-b', '0.2', '2026-09-06'),
    ]);

    expect(
      completeQuantity(
        project(current, '2026-09-07'),
      ).currentOfficialQuantity.toString(),
    ).toBe('0.3');
  });

  it('feeds existing LAW 2 without losing raw overrun or its bounded contribution', () => {
    const current = prove([entry('overrun', '15', '2026-09-05')]);
    const temporal = completeQuantity(project(current, '2026-09-07'));
    const itemProgress = calculateWorkItemCurrentPhysicalProgress({
      currentOfficialQuantity: temporal,
      plannedQuantity: '10',
      plannedUnit: 'm3',
    });

    expect(itemProgress.state).toBe('COMPLETE');
    if (itemProgress.state === 'COMPLETE') {
      expect(itemProgress.rawPhysicalProgressPercent.toString()).toBe('150');
      expect(itemProgress.boundedContributionProgressPercent.toString()).toBe(
        '100',
      );
    }
  });

  it('feeds existing LAW 3 with bounded contribution and no H2-A1 renormalization', () => {
    const fullTemporal = completeQuantity(
      project(prove([entry('full', '10', '2026-09-05')]), '2026-09-07'),
    );
    const partialTemporal = completeQuantity(
      project(prove([entry('partial', '3', '2026-09-05')]), '2026-09-07'),
    );
    const full = calculateWorkItemCurrentPhysicalProgress({
      currentOfficialQuantity: fullTemporal,
      plannedQuantity: '10',
      plannedUnit: 'm3',
    });
    const partial = calculateWorkItemCurrentPhysicalProgress({
      currentOfficialQuantity: partialTemporal,
      plannedQuantity: '10',
      plannedUnit: 'm3',
    });
    const weighted = calculateCurrentOfficialRabWeightedPhysicalProgress({
      projectWeight: {
        basis: MONITORING_WEIGHT_BASIS,
        completeness: 'INCOMPLETE',
        reason: null,
        denominator: { state: 'AVAILABLE', value: '100' },
        eligibleWorkItemCount: 3,
        weightedWorkItemCount: 2,
        unavailableWorkItemCount: 1,
      },
      workItems: [
        {
          boqItemId: 'full',
          rabWeight: {
            state: 'AVAILABLE',
            percentage: '30',
            reason: null,
          },
          currentOfficialItemProgress: full,
        },
        {
          boqItemId: 'partial',
          rabWeight: {
            state: 'AVAILABLE',
            percentage: '40',
            reason: null,
          },
          currentOfficialItemProgress: partial,
        },
      ],
    });

    expect(weighted.state).toBe('INCOMPLETE');
    if (weighted.state === 'INCOMPLETE') {
      expect(weighted.knownWeightedContributionSubtotalPercent.toString()).toBe(
        '42',
      );
    }
  });

  it('fails closed for a malformed Project Business Date cutoff', () => {
    const current = prove([entry('valid', '4', '2026-09-05')]);

    expect(project(current, '2026-09-31')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'INVALID_PROJECT_BUSINESS_CUTOFF',
    });
    expect(project(current, '2026-09-07T00:00:00.000Z')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'INVALID_PROJECT_BUSINESS_CUTOFF',
    });
  });

  it('is deterministic and does not mutate its input', () => {
    const current = prove([
      entry('stable-b', '2', '2026-09-06'),
      entry('stable-a', '1', '2026-09-05'),
    ]);
    const before = current.map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      supersedesEntryId: candidate.supersedesEntryId,
      quantity: candidate.installedQuantity.toString(),
      workDate: candidate.workDate?.toISOString() ?? null,
      auditCount: candidate.auditEvents.length,
    }));
    const first = completeQuantity(project(current, '2026-09-07'));
    const second = completeQuantity(
      project([...current].reverse(), '2026-09-07'),
    );

    expect(first.currentOfficialQuantity.toString()).toBe('3');
    expect(second.currentOfficialQuantity.toString()).toBe('3');
    expect(
      current.map((candidate) => ({
        id: candidate.id,
        status: candidate.status,
        supersedesEntryId: candidate.supersedesEntryId,
        quantity: candidate.installedQuantity.toString(),
        workDate: candidate.workDate?.toISOString() ?? null,
        auditCount: candidate.auditEvents.length,
      })),
    ).toEqual(before);
  });
});

import {
  Prisma,
  ProgressActualStatus,
  ProgressAuditOutcome,
} from '@prisma/client';
import type { ExecutionPlanProjectionDistribution } from '../execution-plan/execution-plan-projection.policy';
import { prepareActualTemporalOfficialQuantity } from './progress-actual-temporal-quantity.policy';
import { PROGRESS_AUTHORITIES } from './progress-authority.service';
import type { Law1CalculationEntry } from './progress-current-official-quantity.policy';
import {
  ACTUAL_PERIOD_WINDOW_TRUTH_MODE,
  PERIOD_WINDOW_BOUNDARY_BASIS,
  PERIOD_WINDOW_MODE,
  projectActualItemPeriodOfficialFacts,
  projectActualItemPeriodWindow,
  projectPlannedItemPeriodWindow,
  validateProjectBusinessDateWindow,
} from './progress-period-window.policy';
import type { ProgressComparisonPlannedCurve } from './progress-planned-actual-comparison.policy';
import {
  createProgressSemanticVerificationContext,
  MON04_SEMANTIC_AUDIT_ACTION,
  progressSemanticProofMetadata,
  type ProgressSemanticContextScope,
} from './progress-semantic-authority.policy';

describe('MON-04 canonical explicit period-window projection v1', () => {
  const scope: ProgressSemanticContextScope = {
    projectId: 'project-window',
    activeBaselineId: 'baseline-window',
    boqItemId: 'item-window',
  };
  const completePlannedCurve: ProgressComparisonPlannedCurve = {
    state: 'COMPLETE',
    reason: null,
    points: [],
  };

  const businessDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const distribution = (
    id: string,
    endDate: string,
    quantity: string,
    startDate = endDate,
  ): ExecutionPlanProjectionDistribution => ({
    id,
    boqItemId: scope.boqItemId,
    periodStartDate: businessDate(startDate),
    periodEndDate: businessDate(endDate),
    plannedIncrementalQuantity: new Prisma.Decimal(quantity),
  });

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
    recordedByAccountId: 'actor-window',
    revision: 1,
    auditEvents: [],
    ...overrides,
  });

  const prove = (
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
                occurredAt: new Date('2026-09-20T12:00:00.000Z'),
                actorAccountId: 'actor-verify',
                authorityCode: PROGRESS_AUTHORITIES.VERIFY,
                metadata,
              },
            ],
          }
        : candidate,
    );
  };

  const window = (startDate: string, endDate: string) => {
    const result = validateProjectBusinessDateWindow(startDate, endDate);
    if (result.state !== 'VALID') throw new Error('VALID_WINDOW_REQUIRED');
    return result.window;
  };

  const actual = (
    entries: readonly Law1CalculationEntry[],
    startDate: string,
    endDate: string,
  ) =>
    projectActualItemPeriodWindow({
      governed: prepareActualTemporalOfficialQuantity(scope, entries),
      window: window(startDate, endDate),
    });

  const facts = (
    entries: readonly Law1CalculationEntry[],
    startDate: string,
    endDate: string,
  ) =>
    projectActualItemPeriodOfficialFacts({
      governed: prepareActualTemporalOfficialQuantity(scope, entries),
      window: window(startDate, endDate),
    });

  const completeActualQuantity = (
    result: ReturnType<typeof actual>,
  ): string => {
    if (result.state !== 'COMPLETE') {
      throw new Error('COMPLETE_ACTUAL_PERIOD_QUANTITY_REQUIRED');
    }
    return result.currentOfficialQuantity.toString();
  };

  it('declares explicit inclusive-window and restated-current-truth provenance', () => {
    expect(PERIOD_WINDOW_MODE).toBe(
      'CANONICAL_PLANNED_AND_ACTUAL_ITEM_PERIOD_WINDOW',
    );
    expect(PERIOD_WINDOW_BOUNDARY_BASIS).toBe(
      'INCLUSIVE_PROJECT_BUSINESS_DATE_WINDOW',
    );
    expect(ACTUAL_PERIOD_WINDOW_TRUTH_MODE).toBe(
      'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_EXPLICIT_WORKDATE_WINDOW',
    );
  });

  it('validates normal and same-day Project Business Date windows', () => {
    expect(
      validateProjectBusinessDateWindow('2026-09-01', '2026-09-07'),
    ).toEqual({
      state: 'VALID',
      window: { startDate: '2026-09-01', endDate: '2026-09-07' },
    });
    expect(
      validateProjectBusinessDateWindow('2026-09-07', '2026-09-07'),
    ).toEqual({
      state: 'VALID',
      window: { startDate: '2026-09-07', endDate: '2026-09-07' },
    });
  });

  it.each([
    [
      'invalid start',
      '2026-02-30',
      '2026-09-07',
      'INVALID_PERIOD_WINDOW_START_DATE',
    ],
    [
      'invalid end',
      '2026-09-01',
      '2026-02-30',
      'INVALID_PERIOD_WINDOW_END_DATE',
    ],
    ['reversed', '2026-09-08', '2026-09-07', 'PERIOD_WINDOW_START_AFTER_END'],
  ])('rejects %s', (_label, startDate, endDate, reason) => {
    expect(validateProjectBusinessDateWindow(startDate, endDate)).toEqual({
      state: 'INVALID',
      reason,
    });
  });

  it('credits full Planned quantities only on inclusive periodEndDate and computes cumulative through end', () => {
    const distributions = [
      distribution('before', '2026-08-31', '1'),
      distribution('on-start', '2026-09-01', '2'),
      distribution('inside', '2026-09-04', '3'),
      distribution('on-end', '2026-09-07', '4'),
      distribution('after', '2026-09-08', '5'),
      distribution('long', '2026-09-10', '100', '2026-09-01'),
    ];

    const result = projectPlannedItemPeriodWindow({
      boqItemId: scope.boqItemId,
      window: window('2026-09-01', '2026-09-07'),
      plannedCurve: completePlannedCurve,
      distributions,
    });

    expect(result.periodQuantity.state).toBe('COMPLETE');
    expect(result.cumulativeQuantityThroughEndDate.state).toBe('COMPLETE');
    if (
      result.periodQuantity.state === 'COMPLETE' &&
      result.cumulativeQuantityThroughEndDate.state === 'COMPLETE'
    ) {
      expect(result.periodQuantity.plannedQuantity.toString()).toBe('9');
      expect(
        result.cumulativeQuantityThroughEndDate.plannedQuantity.toString(),
      ).toBe('10');
    }
    expect(distributions).toHaveLength(6);
  });

  it('keeps a long overlapping distribution at zero until its canonical end credit date', () => {
    const result = projectPlannedItemPeriodWindow({
      boqItemId: scope.boqItemId,
      window: window('2026-09-01', '2026-09-07'),
      plannedCurve: completePlannedCurve,
      distributions: [distribution('long', '2026-09-10', '100', '2026-09-01')],
    });

    if (
      result.periodQuantity.state !== 'COMPLETE' ||
      result.cumulativeQuantityThroughEndDate.state !== 'COMPLETE'
    ) {
      throw new Error('COMPLETE_PLANNED_PERIOD_REQUIRED');
    }
    expect(result.periodQuantity.plannedQuantity.toString()).toBe('0');
    expect(
      result.cumulativeQuantityThroughEndDate.plannedQuantity.toString(),
    ).toBe('0');
  });

  it('returns a lawful Planned zero when a complete plan has no credited distribution in the window', () => {
    const result = projectPlannedItemPeriodWindow({
      boqItemId: scope.boqItemId,
      window: window('2026-08-01', '2026-08-07'),
      plannedCurve: completePlannedCurve,
      distributions: [distribution('future', '2026-09-07', '10')],
    });

    expect(result.periodQuantity).toMatchObject({
      state: 'COMPLETE',
      plannedQuantity: new Prisma.Decimal(0),
    });
    expect(result.cumulativeQuantityThroughEndDate).toMatchObject({
      state: 'COMPLETE',
      plannedQuantity: new Prisma.Decimal(0),
    });
  });

  it('propagates Planned incomplete and unavailable authority without false complete values', () => {
    const incomplete = projectPlannedItemPeriodWindow({
      boqItemId: scope.boqItemId,
      window: window('2026-09-01', '2026-09-07'),
      plannedCurve: {
        state: 'INCOMPLETE',
        reason: 'KNOWN_SUBTOTAL_ONLY',
        points: [],
      },
      distributions: [distribution('known', '2026-09-07', '4')],
    });
    const unavailable = projectPlannedItemPeriodWindow({
      boqItemId: scope.boqItemId,
      window: window('2026-09-01', '2026-09-07'),
      plannedCurve: {
        state: 'UNAVAILABLE',
        reason: 'BASELINE_BINDING_MISMATCH',
        points: [],
      },
      distributions: [distribution('ignored', '2026-09-07', '10')],
    });

    expect(incomplete.periodQuantity).toMatchObject({
      state: 'INCOMPLETE',
      reason: 'KNOWN_SUBTOTAL_ONLY',
      knownPlannedQuantitySubtotal: new Prisma.Decimal(4),
    });
    expect(unavailable).toEqual({
      periodQuantity: {
        state: 'UNAVAILABLE',
        reason: 'BASELINE_BINDING_MISMATCH',
      },
      cumulativeQuantityThroughEndDate: {
        state: 'UNAVAILABLE',
        reason: 'BASELINE_BINDING_MISMATCH',
      },
    });
  });

  it('includes Actual current governed facts on both inclusive boundaries and preserves exact decimals', () => {
    const current = prove([
      entry('before', '0.1', '2026-08-31'),
      entry('on-start', '0.2', '2026-09-01'),
      entry('inside', '0.03', '2026-09-04'),
      entry('on-end', '0.004', '2026-09-07'),
      entry('after', '9', '2026-09-08'),
    ]);

    expect(
      completeActualQuantity(actual(current, '2026-09-01', '2026-09-07')),
    ).toBe('0.234');
    expect(
      completeActualQuantity(actual(current, '2026-09-07', '2026-09-07')),
    ).toBe('0.004');
  });

  it('returns a lawful Actual zero when complete governed facts all fall outside the window', () => {
    const current = prove([entry('outside', '7', '2026-09-10')]);
    expect(
      completeActualQuantity(actual(current, '2026-09-01', '2026-09-07')),
    ).toBe('0');
  });

  it('keeps incomplete and unplaceable Actual truth incomplete with its known window subtotal', () => {
    const eligible = entry('eligible', '3', '2026-09-05');
    const submitted = entry('submitted', '4', '2026-09-06', {
      status: ProgressActualStatus.SUBMITTED,
    });
    const incomplete = actual(
      prove([eligible, submitted], ['eligible']),
      '2026-09-01',
      '2026-09-07',
    );
    const unplaceable = actual(
      prove([entry('undated', '5', null)]),
      '2026-09-01',
      '2026-09-07',
    );

    expect(incomplete).toMatchObject({
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: new Prisma.Decimal(3),
    });
    expect(unplaceable).toMatchObject({
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: new Prisma.Decimal(0),
    });
  });

  it('propagates semantic and lineage failures instead of converting them to zero', () => {
    expect(
      actual(
        [entry('unproven', '4', '2026-09-05')],
        '2026-09-01',
        '2026-09-07',
      ),
    ).toEqual({ state: 'SEMANTICS_UNPROVEN' });

    const cycleA = entry('cycle-a', '1', '2026-09-05', {
      supersedesEntryId: 'cycle-b',
    });
    const cycleB = entry('cycle-b', '2', '2026-09-05', {
      supersedesEntryId: 'cycle-a',
    });
    expect(actual([cycleA, cycleB], '2026-09-01', '2026-09-07')).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
    });
  });

  it('resolves correction lineage before assigning current truth to a window', () => {
    const sameDate = prove([
      entry('same-r1', '10', '2026-09-05'),
      entry('same-r2', '8', '2026-09-05', {
        supersedesEntryId: 'same-r1',
        revision: 2,
      }),
    ]);
    const movedLater = prove([
      entry('later-r1', '10', '2026-09-05'),
      entry('later-r2', '8', '2026-09-12', {
        supersedesEntryId: 'later-r1',
        revision: 2,
      }),
    ]);
    const movedEarlier = prove([
      entry('earlier-r1', '10', '2026-09-12'),
      entry('earlier-r2', '8', '2026-09-05', {
        supersedesEntryId: 'earlier-r1',
        revision: 2,
      }),
    ]);

    expect(
      completeActualQuantity(actual(sameDate, '2026-09-01', '2026-09-07')),
    ).toBe('8');
    expect(
      completeActualQuantity(actual(movedLater, '2026-09-01', '2026-09-07')),
    ).toBe('0');
    expect(
      completeActualQuantity(actual(movedLater, '2026-09-08', '2026-09-14')),
    ).toBe('8');
    expect(
      completeActualQuantity(actual(movedEarlier, '2026-09-01', '2026-09-07')),
    ).toBe('8');
    expect(
      completeActualQuantity(actual(movedEarlier, '2026-09-08', '2026-09-14')),
    ).toBe('0');
  });

  it('PE-B1 selects governed facts on exact inclusive boundaries and excludes outside facts', () => {
    const result = facts(
      prove([
        entry('before', '1', '2026-08-31'),
        entry('on-start', '2', '2026-09-01'),
        entry('inside', '3', '2026-09-04'),
        entry('on-end', '4', '2026-09-07'),
        entry('after', '5', '2026-09-08'),
      ]),
      '2026-09-01',
      '2026-09-07',
    );

    expect(result.state).toBe('COMPLETE');
    if (result.state !== 'COMPLETE') return;
    expect(result.facts.map((fact) => fact.entry.id).sort()).toEqual([
      'inside',
      'on-end',
      'on-start',
    ]);
  });

  it('PE-B2..3 never resurrects an in-period predecessor after its current leaf moves outside', () => {
    const current = prove([
      entry('predecessor-inside', '10', '2026-09-05'),
      entry('current-outside', '8', '2026-09-12', {
        supersedesEntryId: 'predecessor-inside',
        revision: 2,
      }),
    ]);
    const result = facts(current, '2026-09-01', '2026-09-07');

    expect(result).toEqual({ state: 'COMPLETE', facts: [] });
  });

  it('PE-B4..8 preserves terminal, incomplete, unplaceable, and complete-empty states', () => {
    expect(
      facts([entry('unproven', '4', '2026-09-05')], '2026-09-01', '2026-09-07'),
    ).toEqual({ state: 'SEMANTICS_UNPROVEN' });

    const cycleA = entry('facts-cycle-a', '1', '2026-09-05', {
      supersedesEntryId: 'facts-cycle-b',
    });
    const cycleB = entry('facts-cycle-b', '2', '2026-09-05', {
      supersedesEntryId: 'facts-cycle-a',
    });
    expect(facts([cycleA, cycleB], '2026-09-01', '2026-09-07')).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
    });

    const eligible = entry('known-inside', '3', '2026-09-05');
    const submitted = entry('submitted-inside', '4', '2026-09-06', {
      status: ProgressActualStatus.SUBMITTED,
    });
    const incomplete = facts(
      prove([eligible, submitted], ['known-inside']),
      '2026-09-01',
      '2026-09-07',
    );
    expect(incomplete.state).toBe('INCOMPLETE');
    if (incomplete.state === 'INCOMPLETE') {
      expect(incomplete.facts.map((fact) => fact.entry.id)).toEqual([
        'known-inside',
      ]);
    }

    expect(
      facts(prove([entry('undated', '5', null)]), '2026-09-01', '2026-09-07'),
    ).toEqual({ state: 'INCOMPLETE', facts: [] });
    expect(
      facts(
        prove([entry('complete-outside', '6', '2026-09-10')]),
        '2026-09-01',
        '2026-09-07',
      ),
    ).toEqual({ state: 'COMPLETE', facts: [] });
  });
});

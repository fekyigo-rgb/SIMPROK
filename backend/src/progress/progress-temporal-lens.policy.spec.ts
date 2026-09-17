import { Prisma, ProgressActualStatus } from '@prisma/client';
import type { CanonicalWorkPeriodAnchor } from '../project/work-period-anchor.policy';
import type {
  CurrentGovernedOfficialFactsResult,
  CurrentOfficialQuantityResult,
  Law1CalculationEntry,
} from './progress-current-official-quantity.policy';
import {
  projectActualItemPeriodWindow,
  projectPlannedItemPeriodWindow,
  type PlannedItemQuantityProjection,
} from './progress-period-window.policy';
import {
  MONITORING_TEMPORAL_LENS_MODE,
  parseMonitoringTemporalLensQuery,
  recapActualWeeklySlicePeriodQuantities,
  recapPlannedWeeklySlicePeriodQuantities,
  resolveMonitoringTemporalLensBoundary,
  TEMPORAL_LENS_WEEKLY_RECAP_RULE,
} from './progress-temporal-lens.policy';

describe('MON-04 canonical Monitoring temporal lens projection', () => {
  const provenAnchor = (
    anchorDate = '2026-05-18',
  ): CanonicalWorkPeriodAnchor => ({
    state: 'PROVEN',
    anchorDate,
    candidateDate: anchorDate,
    provenance: {
      eventId: 'anchor-event',
      action: 'PROJECT_WORK_PERIOD_ANCHOR_ACTIVATED',
      actorAccountId: 'account-owner',
      actorMembershipId: 'membership-owner',
      actorAssignmentId: 'assignment-owner',
      occurredAt: '2026-09-17T00:00:00.000Z',
      reason: null,
    },
  });

  const notProvenAnchor = (
    candidateDate: string | null = null,
  ): CanonicalWorkPeriodAnchor => ({
    state: 'NOT_PROVEN',
    anchorDate: null,
    candidateDate,
    provenance: null,
  });

  const invalidAnchor: CanonicalWorkPeriodAnchor = {
    state: 'INVALID_PROVENANCE',
    anchorDate: null,
    candidateDate: '2026-05-18',
    provenance: null,
    reason: 'GOVERNED_ANCHOR_START_DATE_MISMATCH',
  };

  describe('runtime HTTP query contract', () => {
    it.each([
      [{}, { state: 'DISABLED' }],
      [{ includeTemporalLens: 'false' }, { state: 'DISABLED' }],
    ])('preserves disabled/default Monitoring for %o', (query, expected) => {
      expect(parseMonitoringTemporalLensQuery(query)).toEqual(expected);
    });

    it.each([
      [
        'fields without opt-in',
        { temporalBasis: 'CALENDAR' },
        'TEMPORAL_LENS_FIELDS_REQUIRE_OPT_IN',
      ],
      [
        'missing basis',
        {
          includeTemporalLens: 'true',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
        },
        'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE',
      ],
      [
        'missing granularity',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalReferenceDate: '2026-09-17',
        },
        'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE',
      ],
      [
        'missing reference date',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
        },
        'TEMPORAL_LENS_REQUIRES_BASIS_GRANULARITY_REFERENCE',
      ],
      [
        'unknown basis',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'calendar',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
        },
        'INVALID_TEMPORAL_BASIS',
      ],
      [
        'unknown granularity',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'weekly',
          temporalReferenceDate: '2026-09-17',
        },
        'INVALID_TEMPORAL_GRANULARITY',
      ],
      [
        'impossible date',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-02-30',
        },
        'INVALID_TEMPORAL_REFERENCE_PROJECT_BUSINESS_DATE',
      ],
      [
        'timestamp instead of Project Business Date',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17T00:00:00.000Z',
        },
        'INVALID_TEMPORAL_REFERENCE_PROJECT_BUSINESS_DATE',
      ],
      [
        'array ambiguity',
        {
          includeTemporalLens: ['true'],
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
        },
        'AMBIGUOUS_TEMPORAL_LENS',
      ],
      [
        'bracket ambiguity',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
          'temporalReferenceDate[gte]': '2026-09-01',
        },
        'AMBIGUOUS_TEMPORAL_LENS',
      ],
      [
        'explicit Period Window conflict',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
          includePeriodWindow: 'true',
          periodStartDate: '2026-09-14',
          periodEndDate: '2026-09-20',
        },
        'TEMPORAL_LENS_EXPLICIT_PERIOD_WINDOW_CONFLICT',
      ],
      [
        'cutoff conflict',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
          cutoffDate: '2026-09-17',
        },
        'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT',
      ],
      [
        'Actual Series conflict',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
          includeActualSeries: 'true',
        },
        'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT',
      ],
      [
        'comparison conflict',
        {
          includeTemporalLens: 'true',
          temporalBasis: 'CALENDAR',
          temporalGranularity: 'WEEK',
          temporalReferenceDate: '2026-09-17',
          includeProgressComparison: 'true',
        },
        'TEMPORAL_LENS_CUTOFF_CONTEXT_CONFLICT',
      ],
    ])('rejects %s', (_label, query, reason) => {
      expect(parseMonitoringTemporalLensQuery(query)).toEqual({
        state: 'INVALID',
        reason,
      });
    });

    it('accepts one complete explicit lens context', () => {
      expect(
        parseMonitoringTemporalLensQuery({
          includeTemporalLens: 'true',
          temporalBasis: 'WORK_PERIOD',
          temporalGranularity: 'MONTH',
          temporalReferenceDate: '2026-07-20',
        }),
      ).toEqual({
        state: 'ENABLED',
        input: {
          basis: 'WORK_PERIOD',
          granularity: 'MONTH',
          referenceDate: '2026-07-20',
        },
      });
    });
  });

  describe('canonical boundary connection', () => {
    it('resolves Calendar Week without any Work Period anchor', () => {
      const result = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'CALENDAR',
          granularity: 'WEEK',
          referenceDate: '2024-12-30',
        },
      });

      expect(result).toEqual({
        state: 'RESOLVED',
        period: {
          basis: 'CALENDAR',
          granularity: 'WEEK',
          periodKey: '2025-W01',
          periodIndex: 1,
          startDate: '2024-12-30',
          endDate: '2025-01-05',
          metadata: {
            boundaryInclusivity: 'START_AND_END_INCLUSIVE',
            boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY',
            isoWeekYear: 2025,
            isoWeekNumber: 1,
          },
        },
      });
    });

    it('resolves exact Gregorian Calendar Month and its canonical week slices', () => {
      const result = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'CALENDAR',
          granularity: 'MONTH',
          referenceDate: '2026-09-17',
        },
        governedWorkPeriodAnchor: notProvenAnchor('1999-01-01'),
      });

      expect(result.state).toBe('RESOLVED');
      if (result.state !== 'RESOLVED') return;
      expect(result.period).toMatchObject({
        periodKey: '2026-09',
        periodIndex: 9,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
      expect(result.weeklyRecap?.rule).toBe(TEMPORAL_LENS_WEEKLY_RECAP_RULE);
      expect(result.weeklyRecap?.sliceCount).toBe(5);
      expect(result.weeklyRecap?.slices.at(0)).toMatchObject({
        weekStartDate: '2026-08-31',
        weekEndDate: '2026-09-06',
        sliceStartDate: '2026-09-01',
        sliceEndDate: '2026-09-06',
      });
      expect(result.weeklyRecap?.slices.at(-1)).toMatchObject({
        weekStartDate: '2026-09-28',
        weekEndDate: '2026-10-04',
        sliceStartDate: '2026-09-28',
        sliceEndDate: '2026-09-30',
      });
    });

    it('resolves Work Week ordinals only from a PROVEN governed anchor', () => {
      const week1 = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'WORK_PERIOD',
          granularity: 'WEEK',
          referenceDate: '2026-05-24',
        },
        governedWorkPeriodAnchor: provenAnchor(),
      });
      const week2 = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'WORK_PERIOD',
          granularity: 'WEEK',
          referenceDate: '2026-05-25',
        },
        governedWorkPeriodAnchor: provenAnchor(),
      });

      expect(week1).toMatchObject({
        state: 'RESOLVED',
        period: {
          periodKey: 'WORK-WEEK-1',
          periodIndex: 1,
          startDate: '2026-05-18',
          endDate: '2026-05-24',
        },
      });
      expect(week2).toMatchObject({
        state: 'RESOLVED',
        period: {
          periodKey: 'WORK-WEEK-2',
          periodIndex: 2,
          startDate: '2026-05-25',
          endDate: '2026-05-31',
        },
      });
    });

    it('preserves original-anchor anniversary month clamp without drift', () => {
      const result = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'WORK_PERIOD',
          granularity: 'MONTH',
          referenceDate: '2027-03-30',
        },
        governedWorkPeriodAnchor: provenAnchor('2027-01-31'),
      });

      expect(result).toMatchObject({
        state: 'RESOLVED',
        period: {
          periodKey: 'WORK-MONTH-2',
          periodIndex: 2,
          startDate: '2027-02-28',
          endDate: '2027-03-30',
          metadata: {
            governedWorkPeriodAnchorDate: '2027-01-31',
          },
        },
      });
      if (result.state !== 'RESOLVED') return;
      expect(result.weeklyRecap?.slices.at(-1)).toMatchObject({
        sliceEndDate: '2027-03-30',
      });
    });

    it.each([
      ['missing proof', undefined, 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED'],
      [
        'legacy candidate without proof',
        notProvenAnchor('2026-05-18'),
        'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
      ],
      [
        'invalid provenance',
        invalidAnchor,
        'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
      ],
    ])('fails closed for %s', (_label, anchor, reason) => {
      expect(
        resolveMonitoringTemporalLensBoundary({
          temporalLens: {
            basis: 'WORK_PERIOD',
            granularity: 'WEEK',
            referenceDate: '2026-05-18',
          },
          governedWorkPeriodAnchor: anchor,
        }),
      ).toEqual({ state: 'UNAVAILABLE', reason });
    });

    it('fails closed before the governed anchor without Week 0', () => {
      expect(
        resolveMonitoringTemporalLensBoundary({
          temporalLens: {
            basis: 'WORK_PERIOD',
            granularity: 'WEEK',
            referenceDate: '2026-05-17',
          },
          governedWorkPeriodAnchor: provenAnchor(),
        }),
      ).toEqual({
        state: 'UNAVAILABLE',
        reason: 'REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR',
      });
    });

    it('produces a deterministic, gapless, non-overlapping month partition', () => {
      const first = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'WORK_PERIOD',
          granularity: 'MONTH',
          referenceDate: '2026-06-01',
        },
        governedWorkPeriodAnchor: provenAnchor(),
      });
      const second = resolveMonitoringTemporalLensBoundary({
        temporalLens: {
          basis: 'WORK_PERIOD',
          granularity: 'MONTH',
          referenceDate: '2026-06-01',
        },
        governedWorkPeriodAnchor: provenAnchor(),
      });

      expect(second).toEqual(first);
      expect(first.state).toBe('RESOLVED');
      if (first.state !== 'RESOLVED' || !first.weeklyRecap) return;
      expect(first.weeklyRecap.slices.at(0)?.sliceStartDate).toBe(
        first.period.startDate,
      );
      expect(first.weeklyRecap.slices.at(-1)?.sliceEndDate).toBe(
        first.period.endDate,
      );
      for (let index = 1; index < first.weeklyRecap.slices.length; index += 1) {
        const previous = first.weeklyRecap.slices[index - 1];
        const current = first.weeklyRecap.slices[index];
        const nextDate = new Date(`${previous.sliceEndDate}T00:00:00.000Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        expect(current.sliceStartDate).toBe(
          nextDate.toISOString().slice(0, 10),
        );
        expect(current.sliceStartDate > previous.sliceEndDate).toBe(true);
      }
    });

    it('assigns Planned credit and Actual fact to exact cross-month date slices without proration', () => {
      const entry: Law1CalculationEntry = {
        id: 'actual-aug-31',
        supersedesEntryId: null,
        installedQuantity: '7.5',
        workDate: new Date('2026-08-31T00:00:00.000Z'),
        status: ProgressActualStatus.VERIFIED,
        captureMethod: 'FIELD_MEASUREMENT',
        evidenceReferences: [],
        notes: null,
        correctionReasonCode: null,
        correctionReason: null,
        recordedByAccountId: 'account-field',
        revision: 1,
        auditEvents: [],
      };
      const governed: CurrentGovernedOfficialFactsResult = {
        state: 'COMPLETE',
        eligibleCurrentFacts: [{ entry, quantity: new Prisma.Decimal('7.5') }],
      };
      const distribution = {
        id: 'planned-aug-31',
        boqItemId: 'item-1',
        periodStartDate: new Date('2026-08-20T00:00:00.000Z'),
        periodEndDate: new Date('2026-08-31T00:00:00.000Z'),
        plannedIncrementalQuantity: new Prisma.Decimal('11'),
      };
      const plannedCurve = {
        state: 'COMPLETE' as const,
        reason: null,
        points: [],
      };
      const augustSlice = { startDate: '2026-08-31', endDate: '2026-08-31' };
      const septemberSlice = {
        startDate: '2026-09-01',
        endDate: '2026-09-06',
      };

      const plannedAugust = projectPlannedItemPeriodWindow({
        boqItemId: 'item-1',
        window: augustSlice,
        plannedCurve,
        distributions: [distribution],
      });
      const plannedSeptember = projectPlannedItemPeriodWindow({
        boqItemId: 'item-1',
        window: septemberSlice,
        plannedCurve,
        distributions: [distribution],
      });
      const actualAugust = projectActualItemPeriodWindow({
        governed,
        window: augustSlice,
      });
      const actualSeptember = projectActualItemPeriodWindow({
        governed,
        window: septemberSlice,
      });

      expect(plannedAugust.periodQuantity).toMatchObject({
        state: 'COMPLETE',
        plannedQuantity: new Prisma.Decimal('11'),
      });
      expect(plannedSeptember.periodQuantity).toMatchObject({
        state: 'COMPLETE',
        plannedQuantity: new Prisma.Decimal('0'),
      });
      expect(actualAugust).toMatchObject({
        state: 'COMPLETE',
        currentOfficialQuantity: new Prisma.Decimal('7.5'),
      });
      expect(actualSeptember).toMatchObject({
        state: 'COMPLETE',
        currentOfficialQuantity: new Prisma.Decimal('0'),
      });
    });
  });

  describe('exact weekly-slice recap state law', () => {
    const planned = (
      state: PlannedItemQuantityProjection,
    ): PlannedItemQuantityProjection => state;
    const actual = (
      state: CurrentOfficialQuantityResult,
    ): CurrentOfficialQuantityResult => state;

    it('sums complete Planned slice quantities with exact Decimal arithmetic', () => {
      const result = recapPlannedWeeklySlicePeriodQuantities([
        planned({
          state: 'COMPLETE',
          plannedQuantity: new Prisma.Decimal('0.1'),
        }),
        planned({
          state: 'COMPLETE',
          plannedQuantity: new Prisma.Decimal('0.2'),
        }),
      ]);

      expect(result.state).toBe('COMPLETE');
      if (result.state === 'COMPLETE') {
        expect(result.plannedQuantity.toString()).toBe('0.3');
      }
    });

    it('preserves Planned incomplete known subtotal and unavailable authority', () => {
      const incomplete = recapPlannedWeeklySlicePeriodQuantities([
        planned({
          state: 'COMPLETE',
          plannedQuantity: new Prisma.Decimal('2'),
        }),
        planned({
          state: 'INCOMPLETE',
          reason: 'KNOWN_SUBTOTAL_ONLY',
          knownPlannedQuantitySubtotal: new Prisma.Decimal('3.5'),
        }),
      ]);
      const unavailable = recapPlannedWeeklySlicePeriodQuantities([
        planned({
          state: 'COMPLETE',
          plannedQuantity: new Prisma.Decimal('2'),
        }),
        planned({ state: 'UNAVAILABLE', reason: 'NO_LOCKED_PLAN' }),
      ]);

      expect(incomplete.state).toBe('INCOMPLETE');
      if (incomplete.state === 'INCOMPLETE') {
        expect(incomplete.knownPlannedQuantitySubtotal.toString()).toBe('5.5');
      }
      expect(unavailable).toEqual({
        state: 'UNAVAILABLE',
        reason: 'NO_LOCKED_PLAN',
      });
    });

    it('recaps Planned period quantities and keeps cumulative-at-end separate from weekly cumulative sums', () => {
      const distributions = [
        {
          id: 'credit-1',
          boqItemId: 'item-1',
          periodStartDate: new Date('2026-08-01T00:00:00.000Z'),
          periodEndDate: new Date('2026-08-05T00:00:00.000Z'),
          plannedIncrementalQuantity: new Prisma.Decimal('2'),
        },
        {
          id: 'credit-2',
          boqItemId: 'item-1',
          periodStartDate: new Date('2026-08-08T00:00:00.000Z'),
          periodEndDate: new Date('2026-08-12T00:00:00.000Z'),
          plannedIncrementalQuantity: new Prisma.Decimal('3'),
        },
      ];
      const project = (startDate: string, endDate: string) =>
        projectPlannedItemPeriodWindow({
          boqItemId: 'item-1',
          window: { startDate, endDate },
          plannedCurve: { state: 'COMPLETE', reason: null, points: [] },
          distributions,
        });
      const first = project('2026-08-01', '2026-08-07');
      const final = project('2026-08-08', '2026-08-15');
      const recap = recapPlannedWeeklySlicePeriodQuantities([
        first.periodQuantity,
        final.periodQuantity,
      ]);

      expect(recap.state).toBe('COMPLETE');
      expect(final.cumulativeQuantityThroughEndDate.state).toBe('COMPLETE');
      if (
        recap.state === 'COMPLETE' &&
        first.cumulativeQuantityThroughEndDate.state === 'COMPLETE' &&
        final.cumulativeQuantityThroughEndDate.state === 'COMPLETE'
      ) {
        expect(recap.plannedQuantity.toString()).toBe('5');
        expect(
          final.cumulativeQuantityThroughEndDate.plannedQuantity.toString(),
        ).toBe('5');
        expect(
          first.cumulativeQuantityThroughEndDate.plannedQuantity
            .plus(final.cumulativeQuantityThroughEndDate.plannedQuantity)
            .toString(),
        ).toBe('7');
      }
    });

    it('sums complete Actual slices exactly, including lawful zero', () => {
      const result = recapActualWeeklySlicePeriodQuantities([
        actual({
          state: 'COMPLETE',
          currentOfficialQuantity: new Prisma.Decimal('0'),
        }),
        actual({
          state: 'COMPLETE',
          currentOfficialQuantity: new Prisma.Decimal('1.25'),
        }),
        actual({
          state: 'COMPLETE',
          currentOfficialQuantity: new Prisma.Decimal('2.75'),
        }),
      ]);

      expect(result.state).toBe('COMPLETE');
      if (result.state === 'COMPLETE') {
        expect(result.currentOfficialQuantity.toString()).toBe('4');
      }
    });

    it('preserves Actual incomplete known subtotal', () => {
      const result = recapActualWeeklySlicePeriodQuantities([
        actual({
          state: 'COMPLETE',
          currentOfficialQuantity: new Prisma.Decimal('2'),
        }),
        actual({
          state: 'INCOMPLETE',
          knownEligibleQuantitySubtotal: new Prisma.Decimal('3.5'),
        }),
      ]);

      expect(result.state).toBe('INCOMPLETE');
      if (result.state === 'INCOMPLETE') {
        expect(result.knownEligibleQuantitySubtotal.toString()).toBe('5.5');
      }
    });

    it.each<CurrentOfficialQuantityResult>([
      { state: 'NOT_YET_RECORDED' },
      { state: 'NO_ELIGIBLE_CURRENT_FACT' },
      { state: 'SEMANTICS_UNPROVEN' },
      { state: 'INVALID_NUMERIC_FACT' },
      { state: 'INVALID_LINEAGE', reason: 'DUPLICATE_SUPERSEDED_ENTRY' },
    ])(
      'preserves terminal Actual state $state instead of fabricating zero',
      (terminal) => {
        expect(
          recapActualWeeklySlicePeriodQuantities([
            actual({
              state: 'COMPLETE',
              currentOfficialQuantity: new Prisma.Decimal('4'),
            }),
            terminal,
          ]),
        ).toEqual(terminal);
      },
    );

    it('declares stable mode and recap provenance identities', () => {
      expect(MONITORING_TEMPORAL_LENS_MODE).toBe(
        'CANONICAL_MONITORING_TEMPORAL_LENS_V1',
      );
      expect(TEMPORAL_LENS_WEEKLY_RECAP_RULE).toBe(
        'CANONICAL_WEEK_SLICE_RECAP',
      );
    });
  });
});

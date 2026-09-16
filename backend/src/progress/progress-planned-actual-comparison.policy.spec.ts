import { Prisma } from '@prisma/client';
import { MONITORING_WEIGHT_REASON } from './monitoring-weight';
import {
  calculateProgressDeviationPercentagePoints,
  progressComparisonBoundaries,
  projectPlannedProgressAtBoundary,
} from './progress-planned-actual-comparison.policy';

const completeCurve = {
  state: 'COMPLETE' as const,
  reason: null,
  points: [
    {
      periodEndDate: '2026-09-06',
      knownWeightedPlannedProgressPercent: '8',
    },
    {
      periodEndDate: '2026-09-08',
      knownWeightedPlannedProgressPercent: '26',
    },
    {
      periodEndDate: '2026-09-10',
      knownWeightedPlannedProgressPercent: '50',
    },
  ],
};

describe('MON-04 planned-vs-actual temporal comparator policy', () => {
  it('builds the lawful common boundary union without filler or future points', () => {
    expect(
      progressComparisonBoundaries({
        plannedCurve: completeCurve,
        actualBoundaries: [
          '2026-09-10',
          '2026-09-05',
          '2026-09-07',
          '2026-09-09',
          '2026-09-07',
        ],
        cutoffDate: '2026-09-10',
      }),
    ).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);

    expect(
      progressComparisonBoundaries({
        plannedCurve: completeCurve,
        actualBoundaries: ['2026-09-05', '2026-09-07', '2026-09-09'],
        cutoffDate: '2026-09-07',
      }),
    ).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
  });

  it('projects canonical plannedCurve stepwise with a lawful zero before its first period end', () => {
    expect(
      projectPlannedProgressAtBoundary(completeCurve, '2026-09-05'),
    ).toEqual({
      state: 'COMPLETE',
      plannedRabWeightedPhysicalProgressPercent: new Prisma.Decimal(0),
    });
    expect(
      projectPlannedProgressAtBoundary(completeCurve, '2026-09-07'),
    ).toEqual({
      state: 'COMPLETE',
      plannedRabWeightedPhysicalProgressPercent: new Prisma.Decimal(8),
    });
    expect(
      projectPlannedProgressAtBoundary(completeCurve, '2026-09-09'),
    ).toEqual({
      state: 'COMPLETE',
      plannedRabWeightedPhysicalProgressPercent: new Prisma.Decimal(26),
    });
  });

  it('preserves planned INCOMPLETE and UNAVAILABLE instead of promoting known values', () => {
    expect(
      projectPlannedProgressAtBoundary(
        {
          state: 'INCOMPLETE',
          reason: 'KNOWN_SUBTOTAL_ONLY',
          points: [
            {
              periodEndDate: '2026-09-06',
              knownWeightedPlannedProgressPercent: '8',
            },
          ],
        },
        '2026-09-07',
      ),
    ).toEqual({
      state: 'INCOMPLETE',
      reason: 'KNOWN_SUBTOTAL_ONLY',
      knownWeightedPlannedProgressSubtotalPercent: new Prisma.Decimal(8),
    });

    expect(
      projectPlannedProgressAtBoundary(
        { state: 'UNAVAILABLE', reason: 'H2A1_WEIGHT_UNAVAILABLE', points: [] },
        '2026-09-07',
      ),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'H2A1_WEIGHT_UNAVAILABLE' });
  });

  it('calculates exact percentage points only from two complete sides', () => {
    const planned = projectPlannedProgressAtBoundary(
      completeCurve,
      '2026-09-08',
    );

    expect(
      calculateProgressDeviationPercentagePoints(planned, {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: new Prisma.Decimal(
          '24',
        ),
      }),
    ).toEqual({ state: 'COMPLETE', value: new Prisma.Decimal('-2') });
    expect(
      calculateProgressDeviationPercentagePoints(
        {
          state: 'COMPLETE',
          plannedRabWeightedPhysicalProgressPercent: new Prisma.Decimal(
            '33.333333333333333333',
          ),
        },
        {
          state: 'COMPLETE',
          currentOfficialRabWeightedPhysicalProgressPercent: new Prisma.Decimal(
            '33.333333333333333334',
          ),
        },
      ),
    ).toEqual({
      state: 'COMPLETE',
      value: new Prisma.Decimal('0.000000000000000001'),
    });
    expect(
      calculateProgressDeviationPercentagePoints(
        {
          state: 'COMPLETE',
          plannedRabWeightedPhysicalProgressPercent: new Prisma.Decimal(0),
        },
        {
          state: 'COMPLETE',
          currentOfficialRabWeightedPhysicalProgressPercent: new Prisma.Decimal(
            0,
          ),
        },
      ),
    ).toEqual({ state: 'COMPLETE', value: new Prisma.Decimal(0) });
  });

  it('reports both unresolved sides deterministically', () => {
    expect(
      calculateProgressDeviationPercentagePoints(
        {
          state: 'INCOMPLETE',
          reason: 'KNOWN_SUBTOTAL_ONLY',
          knownWeightedPlannedProgressSubtotalPercent: new Prisma.Decimal(8),
        },
        {
          state: 'UNAVAILABLE',
          reason: MONITORING_WEIGHT_REASON.BASELINE_VALUE_UNAVAILABLE,
        },
      ),
    ).toEqual({
      state: 'UNAVAILABLE',
      reason: {
        planned: 'PLANNED_INCOMPLETE',
        actual: 'ACTUAL_UNAVAILABLE',
      },
    });
  });
});

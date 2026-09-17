import {
  TEMPORAL_BASIS,
  TEMPORAL_GRANULARITY,
  canonicalWeekSlicesForMonth,
  intersectInclusiveDateWindows,
  resolveCanonicalTemporalPeriod,
  type CanonicalTemporalPeriod,
  type CanonicalWeekSlicesForMonthResolution,
  type ResolveCanonicalTemporalPeriodInput,
} from './progress-temporal-boundary.policy';

describe('MON-04 canonical temporal-boundary policy v1', () => {
  const resolved = (
    input: ResolveCanonicalTemporalPeriodInput,
  ): CanonicalTemporalPeriod => {
    const result = resolveCanonicalTemporalPeriod(input);
    if (result.state !== 'RESOLVED') {
      throw new Error(`RESOLVED_PERIOD_REQUIRED:${result.reason}`);
    }
    return result.period;
  };

  const calendar = (granularity: 'WEEK' | 'MONTH', referenceDate: string) =>
    resolved({ basis: 'CALENDAR', granularity, referenceDate });

  const work = (
    granularity: 'WEEK' | 'MONTH',
    referenceDate: string,
    governedWorkPeriodAnchorDate = '2026-05-18',
  ) =>
    resolved({
      basis: 'WORK_PERIOD',
      granularity,
      referenceDate,
      governedWorkPeriodAnchorDate,
    });

  const nextDate = (value: string): string => {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };

  const expectExactPartition = (
    result: CanonicalWeekSlicesForMonthResolution,
  ) => {
    if (result.state !== 'RESOLVED') {
      throw new Error(`RESOLVED_SLICES_REQUIRED:${result.reason}`);
    }
    expect(result.slices.length).toBeGreaterThan(0);
    expect(result.slices[0].sliceStartDate).toBe(result.month.startDate);
    expect(result.slices.at(-1)?.sliceEndDate).toBe(result.month.endDate);
    for (let index = 1; index < result.slices.length; index += 1) {
      expect(result.slices[index].sliceStartDate).toBe(
        nextDate(result.slices[index - 1].sliceEndDate),
      );
      expect(
        result.slices[index - 1].sliceEndDate <
          result.slices[index].sliceStartDate,
      ).toBe(true);
    }
    for (const slice of result.slices) {
      expect(slice.sliceStartDate >= result.month.startDate).toBe(true);
      expect(slice.sliceEndDate <= result.month.endDate).toBe(true);
      expect(slice.sliceStartDate >= slice.week.startDate).toBe(true);
      expect(slice.sliceEndDate <= slice.week.endDate).toBe(true);
    }
  };

  describe('Project Business Date validation', () => {
    it('accepts normal and leap Project Business Dates', () => {
      expect(calendar('MONTH', '2026-09-17')).toMatchObject({
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
      expect(calendar('MONTH', '2028-02-29')).toMatchObject({
        startDate: '2028-02-01',
        endDate: '2028-02-29',
      });
    });

    it.each(['2026-02-30', '2026-13-01', '2026-09-17T00:00:00.000Z'])(
      'fails closed for invalid or non-date-only reference %s',
      (referenceDate) => {
        expect(
          resolveCanonicalTemporalPeriod({
            basis: 'CALENDAR',
            granularity: 'WEEK',
            referenceDate,
          }),
        ).toEqual({
          state: 'UNAVAILABLE',
          reason: 'INVALID_REFERENCE_PROJECT_BUSINESS_DATE',
        });
      },
    );
  });

  describe('Calendar Week', () => {
    it.each([
      ['Monday', '2026-09-07'],
      ['mid-week', '2026-09-09'],
      ['Sunday', '2026-09-13'],
    ])('%s maps to the same inclusive Monday-Sunday week', (_label, date) => {
      expect(calendar('WEEK', date)).toMatchObject({
        basis: TEMPORAL_BASIS.CALENDAR,
        granularity: TEMPORAL_GRANULARITY.WEEK,
        periodKey: '2026-W37',
        periodIndex: 37,
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        metadata: {
          boundaryInclusivity: 'START_AND_END_INCLUSIVE',
          boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY',
          isoWeekYear: 2026,
          isoWeekNumber: 37,
        },
      });
    });

    it.each([
      ['2024-12-30', '2025-W01', 2025, 1, '2024-12-30', '2025-01-05'],
      ['2021-01-01', '2020-W53', 2020, 53, '2020-12-28', '2021-01-03'],
    ])(
      'calculates ISO week identity across year boundaries for %s',
      (date, periodKey, isoWeekYear, isoWeekNumber, startDate, endDate) => {
        expect(calendar('WEEK', date)).toMatchObject({
          periodKey,
          periodIndex: isoWeekNumber,
          startDate,
          endDate,
          metadata: { isoWeekYear, isoWeekNumber },
        });
      },
    );

    it('makes Sunday and the next Monday consecutive without overlap', () => {
      const sunday = calendar('WEEK', '2026-09-13');
      const monday = calendar('WEEK', '2026-09-14');
      expect(nextDate(sunday.endDate)).toBe(monday.startDate);
      expect(sunday.endDate < monday.startDate).toBe(true);
    });

    it('is deterministic for identical input', () => {
      expect(calendar('WEEK', '2026-09-09')).toEqual(
        calendar('WEEK', '2026-09-09'),
      );
    });
  });

  describe('Calendar Month', () => {
    it.each([
      ['31-day month', '2026-01-17', '2026-01-01', '2026-01-31'],
      ['30-day month', '2026-04-17', '2026-04-01', '2026-04-30'],
      ['non-leap February', '2027-02-17', '2027-02-01', '2027-02-28'],
      ['leap February', '2028-02-17', '2028-02-01', '2028-02-29'],
    ])(
      '%s has exact Gregorian boundaries',
      (_label, date, startDate, endDate) => {
        expect(calendar('MONTH', date)).toMatchObject({
          startDate,
          endDate,
        });
      },
    );

    it('rolls December to January as consecutive month windows', () => {
      const december = calendar('MONTH', '2026-12-31');
      const january = calendar('MONTH', '2027-01-01');
      expect(december).toMatchObject({ periodKey: '2026-12', periodIndex: 12 });
      expect(january).toMatchObject({ periodKey: '2027-01', periodIndex: 1 });
      expect(nextDate(december.endDate)).toBe(january.startDate);
    });

    it('is deterministic for identical input', () => {
      expect(calendar('MONTH', '2028-02-29')).toEqual(
        calendar('MONTH', '2028-02-29'),
      );
    });
  });

  describe('Work Week', () => {
    it.each([
      ['reference equals anchor', '2026-05-18', 1, '2026-05-18', '2026-05-24'],
      ['anchor plus six days', '2026-05-24', 1, '2026-05-18', '2026-05-24'],
      ['anchor plus seven days', '2026-05-25', 2, '2026-05-25', '2026-05-31'],
      ['third week boundary', '2026-06-01', 3, '2026-06-01', '2026-06-07'],
      ['far-future ordinal', '2027-05-17', 53, '2027-05-17', '2027-05-23'],
    ])(
      '%s resolves to the correct 1-based seven-day window',
      (_label, date, periodIndex, startDate, endDate) => {
        expect(work('WEEK', date)).toMatchObject({
          basis: TEMPORAL_BASIS.WORK_PERIOD,
          granularity: TEMPORAL_GRANULARITY.WEEK,
          periodKey: `WORK-WEEK-${periodIndex}`,
          periodIndex,
          startDate,
          endDate,
          metadata: {
            boundaryInclusivity: 'START_AND_END_INCLUSIVE',
            boundaryRule: 'SEVEN_DAY_WINDOW_FROM_GOVERNED_WORK_PERIOD_ANCHOR',
            governedWorkPeriodAnchorDate: '2026-05-18',
          },
        });
      },
    );

    it('remains continuous across a year boundary', () => {
      expect(work('WEEK', '2027-01-05', '2026-12-29')).toMatchObject({
        periodKey: 'WORK-WEEK-2',
        startDate: '2027-01-05',
        endDate: '2027-01-11',
      });
    });

    it('fails closed before the governed anchor and never emits week zero', () => {
      expect(
        resolveCanonicalTemporalPeriod({
          basis: 'WORK_PERIOD',
          granularity: 'WEEK',
          referenceDate: '2026-05-17',
          governedWorkPeriodAnchorDate: '2026-05-18',
        }),
      ).toEqual({
        state: 'UNAVAILABLE',
        reason: 'REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR',
      });
    });

    it('fails closed when the governed anchor is missing or invalid', () => {
      expect(
        resolveCanonicalTemporalPeriod({
          basis: 'WORK_PERIOD',
          granularity: 'WEEK',
          referenceDate: '2026-05-18',
        }),
      ).toEqual({
        state: 'UNAVAILABLE',
        reason: 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
      });
      expect(
        resolveCanonicalTemporalPeriod({
          basis: 'WORK_PERIOD',
          granularity: 'WEEK',
          referenceDate: '2026-05-18',
          governedWorkPeriodAnchorDate: '2026-02-30',
        }),
      ).toEqual({
        state: 'UNAVAILABLE',
        reason: 'INVALID_GOVERNED_WORK_PERIOD_ANCHOR_DATE',
      });
    });

    it('is deterministic for identical governed inputs', () => {
      expect(work('WEEK', '2026-06-01')).toEqual(work('WEEK', '2026-06-01'));
    });
  });

  describe('Work Month', () => {
    it('uses ordinary anchor-day anniversaries and exact boundary ownership', () => {
      expect(work('MONTH', '2026-05-18')).toMatchObject({
        periodKey: 'WORK-MONTH-1',
        periodIndex: 1,
        startDate: '2026-05-18',
        endDate: '2026-06-17',
      });
      expect(work('MONTH', '2026-06-17')).toMatchObject({
        periodKey: 'WORK-MONTH-1',
      });
      expect(work('MONTH', '2026-06-18')).toMatchObject({
        periodKey: 'WORK-MONTH-2',
        startDate: '2026-06-18',
        endDate: '2026-07-17',
      });
    });

    it('remains continuous across year rollover', () => {
      const month1 = work('MONTH', '2027-01-17', '2026-12-18');
      const month2 = work('MONTH', '2027-01-18', '2026-12-18');
      expect(month1).toMatchObject({
        startDate: '2026-12-18',
        endDate: '2027-01-17',
      });
      expect(month2).toMatchObject({
        startDate: '2027-01-18',
        endDate: '2027-02-17',
      });
      expect(nextDate(month1.endDate)).toBe(month2.startDate);
    });

    it.each([
      ['day 29', '2027-01-29', '2027-02-28', '2027-02-28', '2027-03-28'],
      ['day 30', '2027-01-30', '2027-02-28', '2027-02-28', '2027-03-29'],
      ['day 31', '2027-01-31', '2027-02-28', '2027-02-28', '2027-03-30'],
    ])(
      '%s clamps only February then recovers the original anchor day',
      (_label, anchor, referenceDate, startDate, endDate) => {
        expect(work('MONTH', referenceDate, anchor)).toMatchObject({
          periodKey: 'WORK-MONTH-2',
          startDate,
          endDate,
        });
      },
    );

    it('handles leap-February clamping from an original day-31 anchor', () => {
      expect(work('MONTH', '2028-02-29', '2028-01-31')).toMatchObject({
        periodKey: 'WORK-MONTH-2',
        startDate: '2028-02-29',
        endDate: '2028-03-30',
      });
    });

    it('proves original-anchor plus N months with no iterative clamp drift', () => {
      const anchor = '2027-01-31';
      expect(work('MONTH', '2027-01-31', anchor)).toMatchObject({
        startDate: '2027-01-31',
        endDate: '2027-02-27',
      });
      expect(work('MONTH', '2027-02-28', anchor)).toMatchObject({
        startDate: '2027-02-28',
        endDate: '2027-03-30',
      });
      expect(work('MONTH', '2027-03-31', anchor)).toMatchObject({
        startDate: '2027-03-31',
        endDate: '2027-04-29',
      });
      expect(work('MONTH', '2027-04-30', anchor)).toMatchObject({
        startDate: '2027-04-30',
        endDate: '2027-05-30',
      });
    });

    it('is deterministic for identical governed inputs', () => {
      expect(work('MONTH', '2027-03-31', '2027-01-31')).toEqual(
        work('MONTH', '2027-03-31', '2027-01-31'),
      );
    });
  });

  describe('inclusive date-window intersection and slicing', () => {
    it.each([
      [
        'full overlap',
        { startDate: '2026-09-01', endDate: '2026-09-30' },
        { startDate: '2026-09-07', endDate: '2026-09-13' },
        { startDate: '2026-09-07', endDate: '2026-09-13' },
      ],
      [
        'partial overlap on the left',
        { startDate: '2026-09-01', endDate: '2026-09-10' },
        { startDate: '2026-09-07', endDate: '2026-09-15' },
        { startDate: '2026-09-07', endDate: '2026-09-10' },
      ],
      [
        'partial overlap on the right',
        { startDate: '2026-09-07', endDate: '2026-09-15' },
        { startDate: '2026-09-01', endDate: '2026-09-10' },
        { startDate: '2026-09-07', endDate: '2026-09-10' },
      ],
      [
        'one-day overlap',
        { startDate: '2026-09-01', endDate: '2026-09-07' },
        { startDate: '2026-09-07', endDate: '2026-09-14' },
        { startDate: '2026-09-07', endDate: '2026-09-07' },
      ],
    ])('%s returns only exact date geometry', (_label, left, right, window) => {
      expect(intersectInclusiveDateWindows(left, right)).toEqual({
        state: 'INTERSECTION',
        window,
      });
    });

    it('returns no intersection and fails closed for an invalid input window', () => {
      expect(
        intersectInclusiveDateWindows(
          { startDate: '2026-09-01', endDate: '2026-09-07' },
          { startDate: '2026-09-08', endDate: '2026-09-14' },
        ),
      ).toEqual({ state: 'NO_INTERSECTION' });
      expect(
        intersectInclusiveDateWindows(
          { startDate: '2026-09-08', endDate: '2026-09-07' },
          { startDate: '2026-09-01', endDate: '2026-09-30' },
        ),
      ).toEqual({
        state: 'INVALID',
        side: 'LEFT',
        reason: 'PERIOD_WINDOW_START_AFTER_END',
      });
    });

    it('slices a Calendar Week at the Gregorian month boundary', () => {
      const week = calendar('WEEK', '2026-09-30');
      const september = calendar('MONTH', '2026-09-30');
      const october = calendar('MONTH', '2026-10-01');
      expect(week).toMatchObject({
        startDate: '2026-09-28',
        endDate: '2026-10-04',
      });
      expect(intersectInclusiveDateWindows(week, september)).toEqual({
        state: 'INTERSECTION',
        window: { startDate: '2026-09-28', endDate: '2026-09-30' },
      });
      expect(intersectInclusiveDateWindows(week, october)).toEqual({
        state: 'INTERSECTION',
        window: { startDate: '2026-10-01', endDate: '2026-10-04' },
      });
    });

    it('slices a Work Week at the Work Month anniversary boundary', () => {
      const week = work('WEEK', '2026-06-18');
      const month1 = work('MONTH', '2026-06-17');
      const month2 = work('MONTH', '2026-06-18');
      expect(week).toMatchObject({
        startDate: '2026-06-15',
        endDate: '2026-06-21',
      });
      expect(intersectInclusiveDateWindows(week, month1)).toEqual({
        state: 'INTERSECTION',
        window: { startDate: '2026-06-15', endDate: '2026-06-17' },
      });
      expect(intersectInclusiveDateWindows(week, month2)).toEqual({
        state: 'INTERSECTION',
        window: { startDate: '2026-06-18', endDate: '2026-06-21' },
      });
    });

    it('enumerates ordered Calendar Week slices with exact month coverage', () => {
      const result = canonicalWeekSlicesForMonth({
        basis: 'CALENDAR',
        referenceDate: '2026-09-17',
      });
      expectExactPartition(result);
      if (result.state !== 'RESOLVED') throw new Error('SLICES_REQUIRED');
      expect(
        result.slices.map(({ week, sliceStartDate, sliceEndDate }) => ({
          week: week.periodKey,
          sliceStartDate,
          sliceEndDate,
        })),
      ).toEqual([
        {
          week: '2026-W36',
          sliceStartDate: '2026-09-01',
          sliceEndDate: '2026-09-06',
        },
        {
          week: '2026-W37',
          sliceStartDate: '2026-09-07',
          sliceEndDate: '2026-09-13',
        },
        {
          week: '2026-W38',
          sliceStartDate: '2026-09-14',
          sliceEndDate: '2026-09-20',
        },
        {
          week: '2026-W39',
          sliceStartDate: '2026-09-21',
          sliceEndDate: '2026-09-27',
        },
        {
          week: '2026-W40',
          sliceStartDate: '2026-09-28',
          sliceEndDate: '2026-09-30',
        },
      ]);
    });

    it('enumerates ordered Work Week slices with exact Work Month coverage', () => {
      const result = canonicalWeekSlicesForMonth({
        basis: 'WORK_PERIOD',
        referenceDate: '2026-06-20',
        governedWorkPeriodAnchorDate: '2026-05-18',
      });
      expectExactPartition(result);
      if (result.state !== 'RESOLVED') throw new Error('SLICES_REQUIRED');
      expect(
        result.slices.map(({ week, sliceStartDate, sliceEndDate }) => ({
          week: week.periodKey,
          sliceStartDate,
          sliceEndDate,
        })),
      ).toEqual([
        {
          week: 'WORK-WEEK-5',
          sliceStartDate: '2026-06-18',
          sliceEndDate: '2026-06-21',
        },
        {
          week: 'WORK-WEEK-6',
          sliceStartDate: '2026-06-22',
          sliceEndDate: '2026-06-28',
        },
        {
          week: 'WORK-WEEK-7',
          sliceStartDate: '2026-06-29',
          sliceEndDate: '2026-07-05',
        },
        {
          week: 'WORK-WEEK-8',
          sliceStartDate: '2026-07-06',
          sliceEndDate: '2026-07-12',
        },
        {
          week: 'WORK-WEEK-9',
          sliceStartDate: '2026-07-13',
          sliceEndDate: '2026-07-17',
        },
      ]);
    });

    it('covers a day-31 short-month Work Month without gap or overlap', () => {
      const result = canonicalWeekSlicesForMonth({
        basis: 'WORK_PERIOD',
        referenceDate: '2027-03-15',
        governedWorkPeriodAnchorDate: '2027-01-31',
      });
      expectExactPartition(result);
      if (result.state !== 'RESOLVED') throw new Error('SLICES_REQUIRED');
      expect(result.month).toMatchObject({
        periodKey: 'WORK-MONTH-2',
        startDate: '2027-02-28',
        endDate: '2027-03-30',
      });
    });

    it('returns date geometry only, never numeric proration or progress truth', () => {
      const result = canonicalWeekSlicesForMonth({
        basis: 'CALENDAR',
        referenceDate: '2026-09-17',
      });
      expect(JSON.stringify(result)).not.toMatch(
        /quantity|progress|percentage|weight|deviation|prorat|decimal/i,
      );
    });
  });

  describe('bounded partition invariants', () => {
    it('maps every sampled Calendar date into exactly one Week and Month', () => {
      let cursor = new Date('2024-12-20T00:00:00.000Z');
      for (let index = 0; index < 500; index += 1) {
        const referenceDate = cursor.toISOString().slice(0, 10);
        const week = calendar('WEEK', referenceDate);
        const month = calendar('MONTH', referenceDate);
        expect(
          referenceDate >= week.startDate && referenceDate <= week.endDate,
        ).toBe(true);
        expect(
          referenceDate >= month.startDate && referenceDate <= month.endDate,
        ).toBe(true);
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      }
    });

    it('forms continuous seven-day Work Week partitions from the anchor', () => {
      const anchor = '2026-05-18';
      let prior: CanonicalTemporalPeriod | null = null;
      let cursor = new Date(`${anchor}T00:00:00.000Z`);
      for (let index = 0; index < 500; index += 1) {
        const referenceDate = cursor.toISOString().slice(0, 10);
        const current = work('WEEK', referenceDate, anchor);
        expect(
          referenceDate >= current.startDate &&
            referenceDate <= current.endDate,
        ).toBe(true);
        if (prior && current.periodKey !== prior.periodKey) {
          expect(nextDate(prior.endDate)).toBe(current.startDate);
          expect(current.periodIndex).toBe(prior.periodIndex + 1);
        }
        prior = current;
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      }
    });

    it.each([
      '2026-01-01',
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
    ])('forms gap-free Work Month partitions for anchor %s', (anchor) => {
      let prior: CanonicalTemporalPeriod | null = null;
      let cursor = new Date(`${anchor}T00:00:00.000Z`);
      for (let index = 0; index < 800; index += 1) {
        const referenceDate = cursor.toISOString().slice(0, 10);
        const current = work('MONTH', referenceDate, anchor);
        expect(
          referenceDate >= current.startDate &&
            referenceDate <= current.endDate,
        ).toBe(true);
        if (prior && current.periodKey !== prior.periodKey) {
          expect(nextDate(prior.endDate)).toBe(current.startDate);
          expect(current.periodIndex).toBe(prior.periodIndex + 1);
        }
        prior = current;
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      }
    });
  });
});

import { parseDateOnlyUtc } from '../common/date-only.util';

export const TEMPORAL_BASIS = {
  CALENDAR: 'CALENDAR',
  WORK_PERIOD: 'WORK_PERIOD',
} as const;

export type TemporalBasis =
  (typeof TEMPORAL_BASIS)[keyof typeof TEMPORAL_BASIS];

export const TEMPORAL_GRANULARITY = {
  WEEK: 'WEEK',
  MONTH: 'MONTH',
} as const;

export type TemporalGranularity =
  (typeof TEMPORAL_GRANULARITY)[keyof typeof TEMPORAL_GRANULARITY];

export type CanonicalTemporalPeriodUnavailableReason =
  | 'INVALID_REFERENCE_PROJECT_BUSINESS_DATE'
  | 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED'
  | 'INVALID_GOVERNED_WORK_PERIOD_ANCHOR_DATE'
  | 'REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR';

export type CanonicalInclusiveDateWindow = {
  startDate: string;
  endDate: string;
};

type CanonicalTemporalPeriodBase = CanonicalInclusiveDateWindow & {
  periodKey: string;
  periodIndex: number;
};

export type CanonicalCalendarWeek = CanonicalTemporalPeriodBase & {
  basis: 'CALENDAR';
  granularity: 'WEEK';
  metadata: {
    boundaryInclusivity: 'START_AND_END_INCLUSIVE';
    boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY';
    isoWeekYear: number;
    isoWeekNumber: number;
  };
};

export type CanonicalCalendarMonth = CanonicalTemporalPeriodBase & {
  basis: 'CALENDAR';
  granularity: 'MONTH';
  metadata: {
    boundaryInclusivity: 'START_AND_END_INCLUSIVE';
    boundaryRule: 'GREGORIAN_CALENDAR_MONTH';
    calendarYear: number;
    calendarMonth: number;
  };
};

export type CanonicalWorkWeek = CanonicalTemporalPeriodBase & {
  basis: 'WORK_PERIOD';
  granularity: 'WEEK';
  metadata: {
    boundaryInclusivity: 'START_AND_END_INCLUSIVE';
    boundaryRule: 'SEVEN_DAY_WINDOW_FROM_GOVERNED_WORK_PERIOD_ANCHOR';
    governedWorkPeriodAnchorDate: string;
  };
};

export type CanonicalWorkMonth = CanonicalTemporalPeriodBase & {
  basis: 'WORK_PERIOD';
  granularity: 'MONTH';
  metadata: {
    boundaryInclusivity: 'START_AND_END_INCLUSIVE';
    boundaryRule: 'ORIGINAL_ANCHOR_ANNIVERSARY_MONTH_WITH_TARGET_CLAMP';
    governedWorkPeriodAnchorDate: string;
  };
};

export type CanonicalTemporalPeriod =
  | CanonicalCalendarWeek
  | CanonicalCalendarMonth
  | CanonicalWorkWeek
  | CanonicalWorkMonth;

export type CanonicalTemporalPeriodResolution =
  | { state: 'RESOLVED'; period: CanonicalTemporalPeriod }
  | {
      state: 'UNAVAILABLE';
      reason: CanonicalTemporalPeriodUnavailableReason;
    };

export type ResolveCanonicalTemporalPeriodInput = {
  basis: TemporalBasis;
  granularity: TemporalGranularity;
  referenceDate: string;
  governedWorkPeriodAnchorDate?: string;
};

export type InclusiveDateWindowIntersectionResult =
  | { state: 'INTERSECTION'; window: CanonicalInclusiveDateWindow }
  | { state: 'NO_INTERSECTION' }
  | {
      state: 'INVALID';
      side: 'LEFT' | 'RIGHT';
      reason:
        | 'INVALID_PERIOD_WINDOW_START_DATE'
        | 'INVALID_PERIOD_WINDOW_END_DATE'
        | 'PERIOD_WINDOW_START_AFTER_END';
    };

export type CanonicalWeekSlice = {
  week: CanonicalCalendarWeek | CanonicalWorkWeek;
  sliceStartDate: string;
  sliceEndDate: string;
};

export type CanonicalWeekSlicesForMonthResolution =
  | {
      state: 'RESOLVED';
      month: CanonicalCalendarMonth | CanonicalWorkMonth;
      slices: CanonicalWeekSlice[];
    }
  | {
      state: 'UNAVAILABLE';
      reason: CanonicalTemporalPeriodUnavailableReason;
    };

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const projectBusinessDate = (
  value: unknown,
): { wire: string; date: Date } | null => {
  if (typeof value !== 'string') return null;
  try {
    return {
      wire: value,
      date: parseDateOnlyUtc(value, 'projectBusinessDate'),
    };
  } catch {
    return null;
  }
};

const dateWire = (value: Date): string => {
  const iso = value.toISOString();
  const wire = iso.slice(0, 10);
  if (iso !== `${wire}T00:00:00.000Z` || projectBusinessDate(wire) === null) {
    throw new Error('TEMPORAL_BOUNDARY_DATE_WIRE_INVARIANT_VIOLATION');
  }
  return wire;
};

const validateInclusiveDateWindow = (
  window: Readonly<CanonicalInclusiveDateWindow>,
):
  | { state: 'VALID'; window: CanonicalInclusiveDateWindow }
  | {
      state: 'INVALID';
      reason:
        | 'INVALID_PERIOD_WINDOW_START_DATE'
        | 'INVALID_PERIOD_WINDOW_END_DATE'
        | 'PERIOD_WINDOW_START_AFTER_END';
    } => {
  const start = projectBusinessDate(window.startDate);
  if (start === null) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_WINDOW_START_DATE' };
  }
  const end = projectBusinessDate(window.endDate);
  if (end === null) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_WINDOW_END_DATE' };
  }
  if (start.wire > end.wire) {
    return { state: 'INVALID', reason: 'PERIOD_WINDOW_START_AFTER_END' };
  }
  return {
    state: 'VALID',
    window: { startDate: start.wire, endDate: end.wire },
  };
};

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * MILLISECONDS_PER_DAY);

const compareDates = (left: Date, right: Date): number =>
  left.getTime() - right.getTime();

const mondayOnOrBefore = (value: Date): Date => {
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  return addDays(value, -daysSinceMonday);
};

const isoWeekIdentity = (
  monday: Date,
): { isoWeekYear: number; isoWeekNumber: number } => {
  const thursday = addDays(monday, 3);
  const isoWeekYear = thursday.getUTCFullYear();
  const firstMonday = mondayOnOrBefore(new Date(Date.UTC(isoWeekYear, 0, 4)));
  const isoWeekNumber =
    Math.floor(
      (monday.getTime() - firstMonday.getTime()) / (7 * MILLISECONDS_PER_DAY),
    ) + 1;
  return { isoWeekYear, isoWeekNumber };
};

const twoDigits = (value: number): string => value.toString().padStart(2, '0');

const calendarWeek = (referenceDate: Date): CanonicalCalendarWeek => {
  const start = mondayOnOrBefore(referenceDate);
  const { isoWeekYear, isoWeekNumber } = isoWeekIdentity(start);
  return {
    basis: TEMPORAL_BASIS.CALENDAR,
    granularity: TEMPORAL_GRANULARITY.WEEK,
    periodKey: `${isoWeekYear}-W${twoDigits(isoWeekNumber)}`,
    periodIndex: isoWeekNumber,
    startDate: dateWire(start),
    endDate: dateWire(addDays(start, 6)),
    metadata: {
      boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY',
      isoWeekYear,
      isoWeekNumber,
    },
  };
};

const calendarMonth = (referenceDate: Date): CanonicalCalendarMonth => {
  const calendarYear = referenceDate.getUTCFullYear();
  const calendarMonth = referenceDate.getUTCMonth() + 1;
  return {
    basis: TEMPORAL_BASIS.CALENDAR,
    granularity: TEMPORAL_GRANULARITY.MONTH,
    periodKey: `${calendarYear}-${twoDigits(calendarMonth)}`,
    periodIndex: calendarMonth,
    startDate: dateWire(new Date(Date.UTC(calendarYear, calendarMonth - 1, 1))),
    endDate: dateWire(new Date(Date.UTC(calendarYear, calendarMonth, 0))),
    metadata: {
      boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'GREGORIAN_CALENDAR_MONTH',
      calendarYear,
      calendarMonth,
    },
  };
};

const workWeek = (
  referenceDate: Date,
  anchorDate: Date,
  anchorWire: string,
): CanonicalWorkWeek => {
  const elapsedDays = Math.floor(
    (referenceDate.getTime() - anchorDate.getTime()) / MILLISECONDS_PER_DAY,
  );
  const periodIndex = Math.floor(elapsedDays / 7) + 1;
  const start = addDays(anchorDate, (periodIndex - 1) * 7);
  return {
    basis: TEMPORAL_BASIS.WORK_PERIOD,
    granularity: TEMPORAL_GRANULARITY.WEEK,
    periodKey: `WORK-WEEK-${periodIndex}`,
    periodIndex,
    startDate: dateWire(start),
    endDate: dateWire(addDays(start, 6)),
    metadata: {
      boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'SEVEN_DAY_WINDOW_FROM_GOVERNED_WORK_PERIOD_ANCHOR',
      governedWorkPeriodAnchorDate: anchorWire,
    },
  };
};

const daysInUtcMonth = (year: number, zeroBasedMonth: number): number =>
  new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();

const originalAnchorMonthBoundary = (
  anchorDate: Date,
  monthOffset: number,
): Date => {
  const absoluteMonth =
    anchorDate.getUTCFullYear() * 12 + anchorDate.getUTCMonth() + monthOffset;
  const year = Math.floor(absoluteMonth / 12);
  const zeroBasedMonth = absoluteMonth - year * 12;
  const day = Math.min(
    anchorDate.getUTCDate(),
    daysInUtcMonth(year, zeroBasedMonth),
  );
  return new Date(Date.UTC(year, zeroBasedMonth, day));
};

const workMonth = (
  referenceDate: Date,
  anchorDate: Date,
  anchorWire: string,
): CanonicalWorkMonth => {
  let boundaryIndex =
    (referenceDate.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 +
    referenceDate.getUTCMonth() -
    anchorDate.getUTCMonth();

  if (
    compareDates(
      originalAnchorMonthBoundary(anchorDate, boundaryIndex),
      referenceDate,
    ) > 0
  ) {
    boundaryIndex -= 1;
  }

  const start = originalAnchorMonthBoundary(anchorDate, boundaryIndex);
  const next = originalAnchorMonthBoundary(anchorDate, boundaryIndex + 1);
  const periodIndex = boundaryIndex + 1;
  return {
    basis: TEMPORAL_BASIS.WORK_PERIOD,
    granularity: TEMPORAL_GRANULARITY.MONTH,
    periodKey: `WORK-MONTH-${periodIndex}`,
    periodIndex,
    startDate: dateWire(start),
    endDate: dateWire(addDays(next, -1)),
    metadata: {
      boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'ORIGINAL_ANCHOR_ANNIVERSARY_MONTH_WITH_TARGET_CLAMP',
      governedWorkPeriodAnchorDate: anchorWire,
    },
  };
};

export function resolveCanonicalTemporalPeriod(
  input: Readonly<ResolveCanonicalTemporalPeriodInput>,
): CanonicalTemporalPeriodResolution {
  const reference = projectBusinessDate(input.referenceDate);
  if (reference === null) {
    return {
      state: 'UNAVAILABLE',
      reason: 'INVALID_REFERENCE_PROJECT_BUSINESS_DATE',
    };
  }
  const referenceDate = reference.date;

  if (input.basis === TEMPORAL_BASIS.CALENDAR) {
    return {
      state: 'RESOLVED',
      period:
        input.granularity === TEMPORAL_GRANULARITY.WEEK
          ? calendarWeek(referenceDate)
          : calendarMonth(referenceDate),
    };
  }

  if (input.governedWorkPeriodAnchorDate === undefined) {
    return {
      state: 'UNAVAILABLE',
      reason: 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
    };
  }

  const anchor = projectBusinessDate(input.governedWorkPeriodAnchorDate);
  if (anchor === null) {
    return {
      state: 'UNAVAILABLE',
      reason: 'INVALID_GOVERNED_WORK_PERIOD_ANCHOR_DATE',
    };
  }
  const anchorDate = anchor.date;
  if (compareDates(referenceDate, anchorDate) < 0) {
    return {
      state: 'UNAVAILABLE',
      reason: 'REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR',
    };
  }

  return {
    state: 'RESOLVED',
    period:
      input.granularity === TEMPORAL_GRANULARITY.WEEK
        ? workWeek(referenceDate, anchorDate, anchor.wire)
        : workMonth(referenceDate, anchorDate, anchor.wire),
  };
}

export function intersectInclusiveDateWindows(
  left: Readonly<CanonicalInclusiveDateWindow>,
  right: Readonly<CanonicalInclusiveDateWindow>,
): InclusiveDateWindowIntersectionResult {
  const validatedLeft = validateInclusiveDateWindow(left);
  if (validatedLeft.state === 'INVALID') {
    return { state: 'INVALID', side: 'LEFT', reason: validatedLeft.reason };
  }
  const validatedRight = validateInclusiveDateWindow(right);
  if (validatedRight.state === 'INVALID') {
    return { state: 'INVALID', side: 'RIGHT', reason: validatedRight.reason };
  }

  const startDate =
    validatedLeft.window.startDate >= validatedRight.window.startDate
      ? validatedLeft.window.startDate
      : validatedRight.window.startDate;
  const endDate =
    validatedLeft.window.endDate <= validatedRight.window.endDate
      ? validatedLeft.window.endDate
      : validatedRight.window.endDate;

  return startDate <= endDate
    ? { state: 'INTERSECTION', window: { startDate, endDate } }
    : { state: 'NO_INTERSECTION' };
}

export function canonicalWeekSlicesForMonth(input: {
  basis: TemporalBasis;
  referenceDate: string;
  governedWorkPeriodAnchorDate?: string;
}): CanonicalWeekSlicesForMonthResolution {
  const monthResolution = resolveCanonicalTemporalPeriod({
    ...input,
    granularity: TEMPORAL_GRANULARITY.MONTH,
  });
  if (monthResolution.state === 'UNAVAILABLE') return monthResolution;

  const month = monthResolution.period as
    | CanonicalCalendarMonth
    | CanonicalWorkMonth;
  const slices: CanonicalWeekSlice[] = [];
  let cursor = month.startDate;

  while (cursor <= month.endDate) {
    const weekResolution = resolveCanonicalTemporalPeriod({
      ...input,
      granularity: TEMPORAL_GRANULARITY.WEEK,
      referenceDate: cursor,
    });
    if (weekResolution.state === 'UNAVAILABLE') return weekResolution;

    const week = weekResolution.period as
      | CanonicalCalendarWeek
      | CanonicalWorkWeek;
    const intersection = intersectInclusiveDateWindows(week, month);
    if (intersection.state !== 'INTERSECTION') {
      throw new Error('TEMPORAL_WEEK_MONTH_SLICE_INVARIANT_VIOLATION');
    }

    slices.push({
      week,
      sliceStartDate: intersection.window.startDate,
      sliceEndDate: intersection.window.endDate,
    });
    cursor = dateWire(
      addDays(
        projectBusinessDate(intersection.window.endDate)?.date ??
          (() => {
            throw new Error('TEMPORAL_SLICE_DATE_INVARIANT_VIOLATION');
          })(),
        1,
      ),
    );
  }

  return { state: 'RESOLVED', month, slices };
}

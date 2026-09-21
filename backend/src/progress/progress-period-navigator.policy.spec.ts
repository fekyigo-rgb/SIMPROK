import { Prisma } from '@prisma/client';
import { projectBusinessDateAtInstant } from '../common/project-time-zone.util';
import type { CurrentGovernedOfficialFactsResult } from './progress-current-official-quantity.policy';
import {
  enumerateCanonicalTemporalPeriodPage,
  monitoringPeriodNavigatorStatusSupport,
  parseMonitoringPeriodNavigatorQuery,
  resolveCalendarNavigatorStart,
  resolveEarliestGovernedActualWorkDate,
  resolveMonitoringPeriodNavigator,
  MONITORING_PERIOD_NAVIGATOR_MODE,
  PERIOD_NAVIGATOR_PAGE_SIZE,
} from './progress-period-navigator.policy';
import type { CanonicalTemporalPeriod } from './progress-temporal-boundary.policy';

/**
 * PERIOD NAVIGATOR CORE — unlimited history, bounded transport.
 *
 * The enumerator owns no boundary of its own, so these tests assert the SHAPE
 * of a page (which periods appear, in what order, contiguous, no duplicates,
 * nothing in the future, never more than one page's worth) and leave the
 * boundaries themselves to the canonical resolver already proven in
 * progress-temporal-boundary.policy.spec.
 *
 * Calendar reference facts used below, all in 2026:
 *   2026-08-01 is a Saturday, so 2026-08-17 is a Monday and 2026-08-18 a Tuesday.
 *   The ISO week holding 2026-08-18 is 2026-W34, 17–23 Aug.
 */

const ANCHOR = '2026-08-01';
const TODAY = '2026-08-18';

type Page = Extract<
  ReturnType<typeof enumerateCanonicalTemporalPeriodPage>,
  { state: 'RESOLVED' }
>;

const page = (
  result: ReturnType<typeof enumerateCanonicalTemporalPeriodPage>,
): Page => {
  if (result.state !== 'RESOLVED') {
    throw new Error(`expected RESOLVED, got ${result.reason}`);
  }
  return result;
};

const workWeekPage = (overrides: { pageEndDate?: string } = {}) =>
  enumerateCanonicalTemporalPeriodPage({
    basis: 'WORK_PERIOD',
    granularity: 'WEEK',
    horizonStartDate: ANCHOR,
    pageEndDate: overrides.pageEndDate ?? TODAY,
    governedWorkPeriodAnchorDate: ANCHOR,
  });

/** Walks every page of a horizon, returning the periods in encounter order. */
const traverse = (input: {
  basis: 'WORK_PERIOD' | 'CALENDAR';
  granularity: 'WEEK' | 'MONTH';
  horizonStartDate: string;
  pageEndDate: string;
  governedWorkPeriodAnchorDate?: string;
}) => {
  const all: CanonicalTemporalPeriod[] = [];
  const pageLengths: number[] = [];
  let cursor: string | null = input.pageEndDate;
  let pages = 0;
  let terminal: Page | null = null;

  while (cursor !== null) {
    pages += 1;
    if (pages > 500) throw new Error('TRAVERSAL_DID_NOT_TERMINATE');
    const current = page(
      enumerateCanonicalTemporalPeriodPage({ ...input, pageEndDate: cursor }),
    );
    all.push(...current.periods);
    pageLengths.push(current.periods.length);
    terminal = current;
    cursor = current.olderCursor;
  }

  return { all, pageLengths, pages, terminal: terminal as Page };
};

// ─────────────────────────────────────────────────────────────────────────────
// C/D/G/H — FIRST PAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('enumerateCanonicalTemporalPeriodPage', () => {
  it('C. WEEK first page lists Work Weeks latest-first', () => {
    const first = page(workWeekPage());

    expect(first.periods.map((p) => p.periodKey)).toEqual([
      'WORK-WEEK-3',
      'WORK-WEEK-2',
      'WORK-WEEK-1',
    ]);
    expect(first.periods[2]).toMatchObject({
      startDate: '2026-08-01',
      endDate: '2026-08-07',
    });
    expect(first.hasMoreOlder).toBe(false);
    expect(first.olderCursor).toBeNull();
  });

  it('D. MONTH first page lists Work Months latest-first', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'WORK_PERIOD',
        granularity: 'MONTH',
        horizonStartDate: ANCHOR,
        pageEndDate: TODAY,
        governedWorkPeriodAnchorDate: ANCHOR,
      }),
    );

    expect(first.periods.map((p) => p.periodKey)).toEqual(['WORK-MONTH-1']);
    expect(first.periods[0]).toMatchObject({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    expect(first.hasMoreOlder).toBe(false);
  });

  it('G. the current period holding the page end is included even though it ends later', () => {
    const current = page(workWeekPage()).periods[0];
    expect(current.startDate <= TODAY).toBe(true);
    expect(current.endDate > TODAY).toBe(true);
  });

  it('H. the next period, which has not begun, is excluded', () => {
    const first = page(workWeekPage());
    expect(first.periods.every((p) => p.startDate <= TODAY)).toBe(true);
    expect(first.periods.map((p) => p.periodKey)).not.toContain('WORK-WEEK-4');
  });

  it('F. Calendar first page lists ISO Monday–Sunday weeks, cross-month week intact', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: ANCHOR,
        pageEndDate: TODAY,
      }),
    );

    expect(first.periods.map((p) => p.periodKey)).toEqual([
      '2026-W34',
      '2026-W33',
      '2026-W32',
      '2026-W31',
    ]);
    expect(first.periods[0]).toMatchObject({
      startDate: '2026-08-17',
      endDate: '2026-08-23',
    });
    // The oldest week began in July and stays ONE canonical ISO week.
    expect(first.periods[3]).toMatchObject({
      startDate: '2026-07-27',
      endDate: '2026-08-02',
    });
    expect(first.hasMoreOlder).toBe(false);
  });

  it('carries the month-end anchor clamp exactly as the resolver does', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'WORK_PERIOD',
        granularity: 'MONTH',
        horizonStartDate: '2026-01-31',
        pageEndDate: '2026-03-05',
        governedWorkPeriodAnchorDate: '2026-01-31',
      }),
    );

    expect(first.periods.map((p) => p.periodKey)).toEqual([
      'WORK-MONTH-2',
      'WORK-MONTH-1',
    ]);
    expect(first.periods[1]).toMatchObject({
      startDate: '2026-01-31',
      endDate: '2026-02-27',
    });
    expect(first.periods[0]).toMatchObject({
      startDate: '2026-02-28',
      endDate: '2026-03-30',
    });
  });

  it('keeps periods with no recorded work — a page never sees an Actual', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'WORK_PERIOD',
        granularity: 'WEEK',
        horizonStartDate: ANCHOR,
        pageEndDate: '2026-10-09',
        governedWorkPeriodAnchorDate: ANCHOR,
      }),
    );
    expect(first.periods).toHaveLength(10);
    expect(first.periods.map((p) => p.periodIndex)).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // I/J/K — TRANSPORT BOUND AND CONTINUATION
  // ───────────────────────────────────────────────────────────────────────────

  it('I. one page never carries more than the transport bound', () => {
    expect(PERIOD_NAVIGATOR_PAGE_SIZE).toBe(64);

    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2020-01-01',
        pageEndDate: TODAY,
      }),
    );
    expect(first.periods).toHaveLength(PERIOD_NAVIGATOR_PAGE_SIZE);
    expect(first.hasMoreOlder).toBe(true);
  });

  it('J. a full fixed page names where the older page begins', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2020-01-01',
        pageEndDate: TODAY,
      }),
    );

    expect(first.periods).toHaveLength(PERIOD_NAVIGATOR_PAGE_SIZE);
    expect(first.hasMoreOlder).toBe(true);
    expect(first.olderCursor).not.toBeNull();

    const oldest = first.periods[first.periods.length - 1];
    const expectedCursor = new Date(oldest.startDate + 'T00:00:00.000Z');
    expectedCursor.setUTCDate(expectedCursor.getUTCDate() - 1);

    expect(first.olderCursor).toBe(expectedCursor.toISOString().slice(0, 10));
  });

  it('K. the next fixed page resumes with no gap and no overlap', () => {
    const first = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2020-01-01',
        pageEndDate: TODAY,
      }),
    );

    expect(first.periods).toHaveLength(PERIOD_NAVIGATOR_PAGE_SIZE);
    expect(first.hasMoreOlder).toBe(true);
    expect(first.olderCursor).not.toBeNull();

    const second = page(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2020-01-01',
        pageEndDate: first.olderCursor as string,
      }),
    );

    expect(second.periods.length).toBeLessThanOrEqual(
      PERIOD_NAVIGATOR_PAGE_SIZE,
    );

    // No overlap: nothing from page 1 reappears.
    const firstKeys = new Set(first.periods.map((p) => p.periodKey));
    expect(second.periods.some((p) => firstKeys.has(p.periodKey))).toBe(false);

    // No gap: the next page's newest canonical period ends exactly at
    // the server-issued olderCursor from the preceding page.
    expect(second.periods[0].endDate).toBe(first.olderCursor);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // L — LONG HORIZON, FULLY REACHABLE
  // ───────────────────────────────────────────────────────────────────────────

  it('L. a 126-year weekly horizon is fully reachable page by page, and never refused', () => {
    const walk = traverse({
      basis: 'CALENDAR',
      granularity: 'WEEK',
      horizonStartDate: '1900-01-01',
      pageEndDate: TODAY,
    });

    // Every page is bounded; every page but the last is exactly full.
    expect(walk.pageLengths.every((n) => n <= PERIOD_NAVIGATOR_PAGE_SIZE)).toBe(
      true,
    );
    expect(
      walk.pageLengths
        .slice(0, -1)
        .every((n) => n === PERIOD_NAVIGATOR_PAGE_SIZE),
    ).toBe(true);

    // The whole lawful history is reached — no product-duration refusal.
    expect(walk.all.length).toBeGreaterThan(6500);
    expect(walk.terminal.hasMoreOlder).toBe(false);
    expect(walk.terminal.olderCursor).toBeNull();

    // Latest first overall, unique, and gap-free across every page boundary.
    expect(new Set(walk.all.map((p) => p.periodKey)).size).toBe(
      walk.all.length,
    );
    for (let i = 1; i < walk.all.length; i += 1) {
      expect(walk.all[i - 1].startDate > walk.all[i].startDate).toBe(true);
      const previousDay = new Date(
        new Date(`${walk.all[i - 1].startDate}T00:00:00.000Z`).getTime() -
          86400000,
      )
        .toISOString()
        .slice(0, 10);
      expect(walk.all[i].endDate).toBe(previousDay);
    }

    // The oldest period is the one CONTAINING the lawful horizon start.
    const oldest = walk.all[walk.all.length - 1];
    expect(oldest.startDate <= '1900-01-01').toBe(true);
    expect(oldest.endDate >= '1900-01-01').toBe(true);
  });

  it('L(month). a long monthly horizon is likewise fully reachable', () => {
    const walk = traverse({
      basis: 'CALENDAR',
      granularity: 'MONTH',
      horizonStartDate: '1990-01-01',
      pageEndDate: TODAY,
    });

    expect(walk.pages).toBeGreaterThan(1);
    expect(walk.pageLengths.every((n) => n <= PERIOD_NAVIGATOR_PAGE_SIZE)).toBe(
      true,
    );
    expect(walk.all.length).toBeGreaterThan(400);
    expect(walk.terminal.hasMoreOlder).toBe(false);
    expect(walk.all[0].periodKey).toBe('2026-08');
    expect(walk.all[walk.all.length - 1].periodKey).toBe('1990-01');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // INPUT VALIDITY
  // ───────────────────────────────────────────────────────────────────────────

  it('refuses a page that ends before the horizon starts', () => {
    expect(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2026-08-18',
        pageEndDate: '2026-08-01',
      }),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'HORIZON_START_AFTER_END' });
  });

  it('refuses malformed horizon or page dates', () => {
    expect(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: '2026-02-30',
        pageEndDate: TODAY,
      }),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'INVALID_HORIZON_START_DATE' });

    expect(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'CALENDAR',
        granularity: 'WEEK',
        horizonStartDate: ANCHOR,
        pageEndDate: '20260818',
      }),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'INVALID_PAGE_END_DATE' });
  });

  it('O. refuses Work Period enumeration without a governed anchor', () => {
    expect(
      enumerateCanonicalTemporalPeriodPage({
        basis: 'WORK_PERIOD',
        granularity: 'WEEK',
        horizonStartDate: ANCHOR,
        pageEndDate: TODAY,
      }),
    ).toEqual({
      state: 'UNAVAILABLE',
      reason: 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS LAW
// ─────────────────────────────────────────────────────────────────────────────

describe('monitoringPeriodNavigatorStatusSupport', () => {
  it('supports only the statuses that report against Project Business Today', () => {
    expect(monitoringPeriodNavigatorStatusSupport('ACTIVE')).toEqual({
      state: 'SUPPORTED',
    });
    expect(monitoringPeriodNavigatorStatusSupport('ON_HOLD')).toEqual({
      state: 'SUPPORTED',
    });
  });

  it('fails closed for every status without a lawful reporting horizon', () => {
    expect(monitoringPeriodNavigatorStatusSupport('PLANNED')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT',
    });
    expect(monitoringPeriodNavigatorStatusSupport('COMPLETED')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE',
    });
    expect(monitoringPeriodNavigatorStatusSupport('CANCELLED')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE',
    });
    expect(monitoringPeriodNavigatorStatusSupport('ARCHIVED')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED',
    });
    expect(monitoringPeriodNavigatorStatusSupport('SOMETHING_NEW')).toEqual({
      state: 'UNAVAILABLE',
      reason: 'PROJECT_STATUS_NOT_SUPPORTED',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P — CALENDAR START PRECEDENCE (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveCalendarNavigatorStart', () => {
  const absent = {
    workPeriodAnchor: { state: 'NOT_PROVEN' } as const,
    lockedPlanStart: { state: 'ABSENT' } as const,
    earliestGovernedActual: { state: 'ABSENT' } as const,
  };

  it('1. prefers a proven Work Period Anchor', () => {
    expect(
      resolveCalendarNavigatorStart({
        ...absent,
        workPeriodAnchor: { state: 'PROVEN', anchorDate: ANCHOR },
        lockedPlanStart: { state: 'RESOLVED', startDate: '2026-07-01' },
        earliestGovernedActual: { state: 'RESOLVED', workDate: '2026-06-01' },
      }),
    ).toEqual({ state: 'RESOLVED', startDate: ANCHOR });
  });

  it('2. falls through an ABSENT anchor to the LOCKED plan start', () => {
    expect(
      resolveCalendarNavigatorStart({
        ...absent,
        lockedPlanStart: { state: 'RESOLVED', startDate: '2026-07-01' },
        earliestGovernedActual: { state: 'RESOLVED', workDate: '2026-06-01' },
      }),
    ).toEqual({ state: 'RESOLVED', startDate: '2026-07-01' });
  });

  it('3. falls through an ABSENT plan to the earliest governed Actual', () => {
    expect(
      resolveCalendarNavigatorStart({
        ...absent,
        earliestGovernedActual: { state: 'RESOLVED', workDate: '2026-06-01' },
      }),
    ).toEqual({ state: 'RESOLVED', startDate: '2026-06-01' });
  });

  it('4. is unavailable when no authoritative execution date exists', () => {
    expect(resolveCalendarNavigatorStart(absent)).toEqual({
      state: 'UNAVAILABLE',
      reason: 'EARLIEST_AUTHORITATIVE_EXECUTION_DATE_UNAVAILABLE',
    });
  });

  it('fails closed on broken anchor provenance instead of falling through', () => {
    expect(
      resolveCalendarNavigatorStart({
        ...absent,
        workPeriodAnchor: { state: 'INVALID_PROVENANCE' },
        lockedPlanStart: { state: 'RESOLVED', startDate: '2026-07-01' },
        earliestGovernedActual: { state: 'RESOLVED', workDate: '2026-06-01' },
      }),
    ).toEqual({
      state: 'UNAVAILABLE',
      reason: 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
    });
  });

  it('R. fails closed on ambiguous or mis-bound plan truth instead of falling through', () => {
    for (const reason of [
      'AMBIGUOUS_EXECUTION_PLAN_CONTEXT',
      'BASELINE_BINDING_MISMATCH',
    ] as const) {
      expect(
        resolveCalendarNavigatorStart({
          ...absent,
          lockedPlanStart: { state: 'UNAVAILABLE', reason },
          earliestGovernedActual: { state: 'RESOLVED', workDate: '2026-06-01' },
        }),
      ).toEqual({ state: 'UNAVAILABLE', reason });
    }
  });

  it('fails closed on unsettled Actual truth', () => {
    expect(
      resolveCalendarNavigatorStart({
        ...absent,
        earliestGovernedActual: {
          state: 'UNAVAILABLE',
          reason: 'ACTUAL_TRUTH_INCOMPLETE',
        },
      }),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_TRUTH_INCOMPLETE' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S — GOVERNED ACTUAL START (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEarliestGovernedActualWorkDate', () => {
  const governedFact = (workDate: string | null) => ({
    entry: {
      id: `entry-${workDate ?? 'null'}`,
      supersedesEntryId: null,
      installedQuantity: '1',
      workDate:
        workDate === null ? null : new Date(`${workDate}T00:00:00.000Z`),
      status: 'ACCEPTED' as never,
      captureMethod: 'FIELD',
      evidenceReferences: [],
      notes: null,
      correctionReasonCode: null,
      correctionReason: null,
      recordedByAccountId: null,
      revision: 1,
      auditEvents: [],
    },
    quantity: new Prisma.Decimal(1),
  });

  const complete = (
    ...workDates: (string | null)[]
  ): CurrentGovernedOfficialFactsResult =>
    ({
      state: 'COMPLETE',
      eligibleCurrentFacts: workDates.map(governedFact),
    }) as unknown as CurrentGovernedOfficialFactsResult;

  it('takes the earliest work date among governed eligible facts', () => {
    expect(
      resolveEarliestGovernedActualWorkDate([
        complete('2026-08-12', '2026-08-05'),
        complete('2026-08-18'),
      ]),
    ).toEqual({ state: 'RESOLVED', workDate: '2026-08-05' });
  });

  it('treats items with nothing recorded as no candidate, not as zero', () => {
    expect(
      resolveEarliestGovernedActualWorkDate([
        { state: 'NOT_YET_RECORDED' },
        { state: 'NO_ELIGIBLE_CURRENT_FACT' },
      ]),
    ).toEqual({ state: 'ABSENT' });

    expect(
      resolveEarliestGovernedActualWorkDate([
        { state: 'NOT_YET_RECORDED' },
        complete('2026-08-05'),
      ]),
    ).toEqual({ state: 'RESOLVED', workDate: '2026-08-05' });
  });

  it('fails closed while official truth is unsettled', () => {
    expect(
      resolveEarliestGovernedActualWorkDate([
        complete('2026-08-05'),
        {
          state: 'INCOMPLETE',
          eligibleCurrentFacts: [],
        } as unknown as CurrentGovernedOfficialFactsResult,
      ]),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_TRUTH_INCOMPLETE' });

    expect(
      resolveEarliestGovernedActualWorkDate([
        { state: 'INVALID_LINEAGE', reason: 'CYCLE' as never },
      ]),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_LINEAGE_INVALID' });

    expect(
      resolveEarliestGovernedActualWorkDate([
        { state: 'INVALID_NUMERIC_FACT' },
      ]),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_NUMERIC_FACT_INVALID' });

    expect(
      resolveEarliestGovernedActualWorkDate([{ state: 'SEMANTICS_UNPROVEN' }]),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_SEMANTICS_UNPROVEN' });
  });

  it('fails closed when an eligible official fact cannot be placed in time', () => {
    expect(
      resolveEarliestGovernedActualWorkDate([complete('2026-08-05', null)]),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'ACTUAL_WORK_DATE_MISSING' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A/B — QUERY LAW
// ─────────────────────────────────────────────────────────────────────────────

describe('parseMonitoringPeriodNavigatorQuery', () => {
  const enabled = {
    includePeriodNavigator: 'true',
    periodNavigatorGranularity: 'WEEK',
    periodNavigatorBasis: 'WORK_PERIOD',
  };

  it('is disabled when absent, leaving existing Monitoring untouched', () => {
    expect(parseMonitoringPeriodNavigatorQuery({})).toEqual({
      state: 'DISABLED',
    });
    expect(
      parseMonitoringPeriodNavigatorQuery({ includePeriodNavigator: 'false' }),
    ).toEqual({ state: 'DISABLED' });
  });

  it('enables with an explicit granularity and basis', () => {
    expect(parseMonitoringPeriodNavigatorQuery(enabled)).toEqual({
      state: 'ENABLED',
      input: { basis: 'WORK_PERIOD', granularity: 'WEEK' },
    });
    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        periodNavigatorGranularity: 'MONTH',
        periodNavigatorBasis: 'CALENDAR',
      }),
    ).toEqual({
      state: 'ENABLED',
      input: { basis: 'CALENDAR', granularity: 'MONTH' },
    });
  });

  it('A. accepts a server-issued cursor and passes it through verbatim', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        periodNavigatorCursor: '2026-08-07',
      }),
    ).toEqual({
      state: 'ENABLED',
      input: {
        basis: 'WORK_PERIOD',
        granularity: 'WEEK',
        cursor: '2026-08-07',
      },
    });
  });

  it('A. refuses a malformed cursor', () => {
    for (const cursor of ['20260807', '2026-02-30', 'yesterday', '']) {
      expect(
        parseMonitoringPeriodNavigatorQuery({
          ...enabled,
          periodNavigatorCursor: cursor,
        }),
      ).toEqual({
        state: 'INVALID',
        reason: 'INVALID_PERIOD_NAVIGATOR_CURSOR',
      });
    }
  });

  it('B. requires a basis once enabled', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({
        includePeriodNavigator: 'true',
        periodNavigatorGranularity: 'WEEK',
      }),
    ).toEqual({ state: 'INVALID', reason: 'PERIOD_NAVIGATOR_REQUIRES_BASIS' });
  });

  it('B. refuses a basis outside the canonical vocabulary', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        periodNavigatorBasis: 'work_period',
      }),
    ).toEqual({ state: 'INVALID', reason: 'INVALID_PERIOD_NAVIGATOR_BASIS' });
  });

  it('refuses navigator fields without opt-in', () => {
    for (const field of [
      { periodNavigatorGranularity: 'WEEK' },
      { periodNavigatorBasis: 'CALENDAR' },
      { periodNavigatorCursor: '2026-08-07' },
    ]) {
      expect(parseMonitoringPeriodNavigatorQuery(field)).toEqual({
        state: 'INVALID',
        reason: 'PERIOD_NAVIGATOR_FIELDS_REQUIRE_OPT_IN',
      });
    }
  });

  it('requires a granularity once enabled', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({ includePeriodNavigator: 'true' }),
    ).toEqual({
      state: 'INVALID',
      reason: 'PERIOD_NAVIGATOR_REQUIRES_GRANULARITY',
    });
  });

  it('refuses a granularity outside the canonical vocabulary', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        periodNavigatorGranularity: 'DAY',
      }),
    ).toEqual({
      state: 'INVALID',
      reason: 'INVALID_PERIOD_NAVIGATOR_GRANULARITY',
    });
  });

  it('refuses ambiguous or malformed query shapes rather than coercing them', () => {
    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        'periodNavigatorCursor[value]': '2026-08-07',
      }),
    ).toEqual({ state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' });

    expect(
      parseMonitoringPeriodNavigatorQuery({
        includePeriodNavigator: ['true'] as never,
      }),
    ).toEqual({ state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' });

    expect(
      parseMonitoringPeriodNavigatorQuery({ includePeriodNavigator: 'yes' }),
    ).toEqual({
      state: 'INVALID',
      reason: 'INVALID_INCLUDE_PERIOD_NAVIGATOR',
    });

    expect(
      parseMonitoringPeriodNavigatorQuery({
        ...enabled,
        periodNavigatorBasis: ['CALENDAR'] as never,
      }),
    ).toEqual({ state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveMonitoringPeriodNavigator', () => {
  const INSTANT = new Date('2026-08-18T10:00:00.000Z');

  const base = {
    basis: 'WORK_PERIOD' as const,
    granularity: 'WEEK' as const,
    requestInstant: INSTANT,
    project: { status: 'ACTIVE', timeZone: 'Asia/Jakarta' },
    hasActiveBaselineContext: true,
    workPeriodAnchor: { state: 'PROVEN' as const, anchorDate: ANCHOR },
    lockedPlanStart: { state: 'ABSENT' as const },
    earliestGovernedActual: { state: 'ABSENT' as const },
    projectBusinessDateAtInstant,
  };

  it('E. resolves one Work Period page for an ACTIVE project', () => {
    const navigator = resolveMonitoringPeriodNavigator(base);

    expect(navigator.mode).toBe(MONITORING_PERIOD_NAVIGATOR_MODE);
    expect(navigator.basis).toBe('WORK_PERIOD');
    expect(navigator.granularity).toBe('WEEK');
    expect(navigator.state).toBe('RESOLVED');
    if (navigator.state !== 'RESOLVED') return;
    expect(navigator.periods[0].periodKey).toBe('WORK-WEEK-3');
    expect(navigator.hasMoreOlder).toBe(false);
    expect(navigator.olderCursor).toBeNull();
  });

  it('F. resolves one Calendar page for an ACTIVE project', () => {
    const navigator = resolveMonitoringPeriodNavigator({
      ...base,
      basis: 'CALENDAR',
    });
    expect(navigator.state).toBe('RESOLVED');
    if (navigator.state !== 'RESOLVED') return;
    expect(navigator.periods[0].periodKey).toBe('2026-W34');
  });

  it('treats ON_HOLD exactly like ACTIVE', () => {
    const navigator = resolveMonitoringPeriodNavigator({
      ...base,
      project: { status: 'ON_HOLD', timeZone: 'Asia/Jakarta' },
    });
    expect(navigator.state).toBe('RESOLVED');
  });

  it('O. Work Period is unavailable when the anchor was never proven', () => {
    const navigator = resolveMonitoringPeriodNavigator({
      ...base,
      workPeriodAnchor: { state: 'NOT_PROVEN' },
    });
    expect(navigator).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED',
      basis: 'WORK_PERIOD',
    });
  });

  it('Calendar stays usable when the Work Period anchor was never proven', () => {
    const navigator = resolveMonitoringPeriodNavigator({
      ...base,
      basis: 'CALENDAR',
      workPeriodAnchor: { state: 'NOT_PROVEN' },
      lockedPlanStart: { state: 'RESOLVED', startDate: '2026-08-03' },
    });
    expect(navigator.state).toBe('RESOLVED');
  });

  it('M. refuses a cursor after Project Business Today', () => {
    expect(
      resolveMonitoringPeriodNavigator({ ...base, cursor: '2026-09-01' }),
    ).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'PERIOD_NAVIGATOR_CURSOR_AFTER_PROJECT_BUSINESS_TODAY',
    });
  });

  it('N. refuses a cursor before the lawful horizon start', () => {
    expect(
      resolveMonitoringPeriodNavigator({ ...base, cursor: '2026-07-31' }),
    ).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'PERIOD_NAVIGATOR_CURSOR_BEFORE_HORIZON_START',
    });
  });

  it('M/N. never silently clamps an out-of-range cursor', () => {
    for (const cursor of ['2026-09-01', '2026-07-31']) {
      const navigator = resolveMonitoringPeriodNavigator({ ...base, cursor });
      expect(navigator.state).toBe('UNAVAILABLE');
    }
  });

  it('honours an in-range cursor by resuming from it', () => {
    const navigator = resolveMonitoringPeriodNavigator({
      ...base,
      cursor: '2026-08-07',
    });
    expect(navigator.state).toBe('RESOLVED');
    if (navigator.state !== 'RESOLVED') return;
    expect(navigator.periods.map((p) => p.periodKey)).toEqual(['WORK-WEEK-1']);
  });

  it('fails closed when a shared prerequisite is missing', () => {
    expect(
      resolveMonitoringPeriodNavigator({
        ...base,
        project: { status: 'ACTIVE', timeZone: null },
      }),
    ).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'PROJECT_TIME_ZONE_NOT_SET',
    });

    expect(
      resolveMonitoringPeriodNavigator({ ...base, project: null }),
    ).toMatchObject({ state: 'UNAVAILABLE', reason: 'PROJECT_NOT_FOUND' });

    expect(
      resolveMonitoringPeriodNavigator({
        ...base,
        hasActiveBaselineContext: false,
      }),
    ).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'NO_ACTIVE_BASELINE_CONTEXT',
    });
  });

  it('fails closed for every status without a terminal business date', () => {
    for (const [status, reason] of [
      ['PLANNED', 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT'],
      ['COMPLETED', 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
      ['CANCELLED', 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'],
      ['ARCHIVED', 'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED'],
    ] as const) {
      expect(
        resolveMonitoringPeriodNavigator({
          ...base,
          project: { status, timeZone: 'Asia/Jakarta' },
        }),
      ).toMatchObject({ state: 'UNAVAILABLE', reason });
    }
  });

  it('ends the horizon at the project zone, not at UTC', () => {
    const lateInstant = new Date('2026-08-21T17:30:00.000Z');

    const jakarta = resolveMonitoringPeriodNavigator({
      ...base,
      requestInstant: lateInstant,
    });
    const utc = resolveMonitoringPeriodNavigator({
      ...base,
      requestInstant: lateInstant,
      project: { status: 'ACTIVE', timeZone: 'UTC' },
    });

    if (jakarta.state !== 'RESOLVED' || utc.state !== 'RESOLVED') {
      throw new Error('expected both RESOLVED');
    }
    expect(jakarta.periods[0].periodKey).toBe('WORK-WEEK-4');
    expect(utc.periods[0].periodKey).toBe('WORK-WEEK-3');
  });

  it('R. propagates a Calendar start refusal for the Calendar basis', () => {
    expect(
      resolveMonitoringPeriodNavigator({
        ...base,
        basis: 'CALENDAR',
        workPeriodAnchor: { state: 'NOT_PROVEN' },
        lockedPlanStart: {
          state: 'UNAVAILABLE',
          reason: 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT',
        },
      }),
    ).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT',
    });
  });
});

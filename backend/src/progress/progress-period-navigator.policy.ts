import {
  parseDateOnlyUtc,
  previousUtcDayStart,
} from '../common/date-only.util';
import { workDateWire } from './progress-actual-temporal-quantity.policy';
import type { CurrentGovernedOfficialFactsResult } from './progress-current-official-quantity.policy';
import {
  resolveCanonicalTemporalPeriod,
  TEMPORAL_BASIS,
  TEMPORAL_GRANULARITY,
  type CanonicalTemporalPeriod,
  type CanonicalTemporalPeriodUnavailableReason,
  type TemporalBasis,
  type TemporalGranularity,
} from './progress-temporal-boundary.policy';

/**
 * CANONICAL MONITORING PERIOD NAVIGATOR — which periods a reader may select.
 *
 * SATU PROYEK. SATU STRUKTUR RAB. SATU PROGRESS TRUTH. BANYAK JENDELA WAKTU.
 *
 * This module answers one question: given a lawful horizon, which canonical
 * periods exist inside it? It decides no boundary of its own. Every period
 * identity, start date and end date comes from `resolveCanonicalTemporalPeriod`
 * — the same resolver the Temporal Lens already uses — so an ISO week is an ISO
 * week here, a Work Month anniversary clamps here exactly as it clamps there,
 * and there is no second temporal law to keep in step.
 *
 * Reporting periods are not planning periods. The horizon ends at Project
 * Business Today, so a period that has not begun is not offered; the plan's
 * future distributions remain Schedule truth. A period inside the horizon stays
 * selectable even when nothing was recorded in it — unknown is not zero.
 */
export const MONITORING_PERIOD_NAVIGATOR_MODE =
  'CANONICAL_MONITORING_PERIOD_NAVIGATOR_V1' as const;

/**
 * TRANSPORT BOUND — how many period identities one response may carry.
 *
 * This is emphatically NOT a maximum project duration. SIMPROK has ratified no
 * such limit and this file imposes none: a project may run for a century and
 * every lawful period of it stays reachable, one page at a time, by following
 * `olderCursor`. The number bounds a single HTTP payload, nothing else.
 */
export const PERIOD_NAVIGATOR_PAGE_SIZE = 64;

// ─────────────────────────────────────────────────────────────────────────────
// PURE PAGED ENUMERATION
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalTemporalPeriodEnumerationUnavailableReason =
  | CanonicalTemporalPeriodUnavailableReason
  | 'INVALID_HORIZON_START_DATE'
  | 'INVALID_PAGE_END_DATE'
  | 'HORIZON_START_AFTER_END';

export type CanonicalTemporalPeriodPage =
  | {
      state: 'RESOLVED';
      periods: CanonicalTemporalPeriod[];
      hasMoreOlder: boolean;
      olderCursor: string | null;
    }
  | {
      state: 'UNAVAILABLE';
      reason: CanonicalTemporalPeriodEnumerationUnavailableReason;
    };

export type EnumerateCanonicalTemporalPeriodPageInput = {
  basis: TemporalBasis;
  granularity: TemporalGranularity;
  horizonStartDate: string;
  /** Inclusive end of THIS page — Project Business Today, or a cursor. */
  pageEndDate: string;
  governedWorkPeriodAnchorDate?: string;
};

/** The Project Business Date one day before `wire`, or null if unusable. */
const dayBefore = (wire: string): string | null => {
  try {
    return previousUtcDayStart(parseDateOnlyUtc(wire, 'periodStartDate'))
      .toISOString()
      .slice(0, 10);
  } catch {
    return null;
  }
};

/** Whether `wire` is an exact Project Business Date, using the canonical parser. */
export const isProjectBusinessDateWire = (wire: unknown): wire is string => {
  if (typeof wire !== 'string') return false;
  try {
    parseDateOnlyUtc(wire, 'horizonDate');
    return true;
  } catch {
    return false;
  }
};

/**
 * One bounded page of canonical periods, latest first.
 *
 * The walk starts at the period containing `pageEndDate` and steps to the day
 * BEFORE each period's start, so periods come out newest-first, contiguous by
 * construction, and never recomputed: every identity and boundary still comes
 * from `resolveCanonicalTemporalPeriod`. Nothing enumerates the whole horizon
 * and slices it — the page stops as soon as it is full.
 *
 * The period containing `pageEndDate` is included even when its own end lies
 * beyond that date; on the first page that is the reader's current period. The
 * next period, which has not begun, is not included. The walk also stops once
 * it steps past `horizonStartDate`, so the oldest lawful period is the one
 * CONTAINING that date even if that period began earlier.
 *
 * `olderCursor` is the Project Business Date immediately before the oldest
 * returned period's start — echo it back and the next page resumes exactly
 * there, with no gap and no overlap.
 *
 * Date-only strings compare lexicographically in calendar order, which is why
 * plain `<=` / `>=` are correct date comparisons here.
 */
export function enumerateCanonicalTemporalPeriodPage(
  input: Readonly<EnumerateCanonicalTemporalPeriodPageInput>,
): CanonicalTemporalPeriodPage {
  if (!isProjectBusinessDateWire(input.horizonStartDate)) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_HORIZON_START_DATE' };
  }
  if (!isProjectBusinessDateWire(input.pageEndDate)) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_PAGE_END_DATE' };
  }
  if (input.horizonStartDate > input.pageEndDate) {
    return { state: 'UNAVAILABLE', reason: 'HORIZON_START_AFTER_END' };
  }

  const periods: CanonicalTemporalPeriod[] = [];
  let cursor: string | null = input.pageEndDate;

  while (
    cursor !== null &&
    cursor >= input.horizonStartDate &&
    periods.length < PERIOD_NAVIGATOR_PAGE_SIZE
  ) {
    const resolution = resolveCanonicalTemporalPeriod({
      basis: input.basis,
      granularity: input.granularity,
      referenceDate: cursor,
      ...(input.governedWorkPeriodAnchorDate === undefined
        ? {}
        : {
            governedWorkPeriodAnchorDate: input.governedWorkPeriodAnchorDate,
          }),
    });
    if (resolution.state === 'UNAVAILABLE') return resolution;

    const period = resolution.period;
    periods.push(period);

    const previous = dayBefore(period.startDate);
    if (previous === null || previous >= cursor) {
      throw new Error(
        'PERIOD_NAVIGATOR_NON_ADVANCING_CURSOR_INVARIANT_VIOLATION',
      );
    }
    cursor = previous;
  }

  const hasMoreOlder = cursor !== null && cursor >= input.horizonStartDate;
  return {
    state: 'RESOLVED',
    periods,
    hasMoreOlder,
    olderCursor: hasMoreOlder ? cursor : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR START PRECEDENCE
// ─────────────────────────────────────────────────────────────────────────────

export type LockedPlanNavigatorStart =
  | { state: 'ABSENT' }
  | { state: 'RESOLVED'; startDate: string }
  | {
      state: 'UNAVAILABLE';
      reason: 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT' | 'BASELINE_BINDING_MISMATCH';
    };

export type GovernedActualNavigatorStartUnavailableReason =
  | 'ACTUAL_TRUTH_INCOMPLETE'
  | 'ACTUAL_LINEAGE_INVALID'
  | 'ACTUAL_NUMERIC_FACT_INVALID'
  | 'ACTUAL_SEMANTICS_UNPROVEN'
  | 'ACTUAL_WORK_DATE_MISSING';

export type GovernedActualNavigatorStart =
  | { state: 'ABSENT' }
  | { state: 'RESOLVED'; workDate: string }
  | {
      state: 'UNAVAILABLE';
      reason: GovernedActualNavigatorStartUnavailableReason;
    };

export type WorkPeriodAnchorNavigatorStart =
  | { state: 'PROVEN'; anchorDate: string }
  | { state: 'NOT_PROVEN' }
  | { state: 'INVALID_PROVENANCE' };

export type CalendarNavigatorStartUnavailableReason =
  | 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID'
  | 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT'
  | 'BASELINE_BINDING_MISMATCH'
  | GovernedActualNavigatorStartUnavailableReason
  | 'EARLIEST_AUTHORITATIVE_EXECUTION_DATE_UNAVAILABLE';

export type CalendarNavigatorStart =
  | { state: 'RESOLVED'; startDate: string }
  | { state: 'UNAVAILABLE'; reason: CalendarNavigatorStartUnavailableReason };

/**
 * The earliest authoritative execution date, by Owner precedence:
 * proven Work Period Anchor, then the authoritative LOCKED plan's first
 * execution start, then the earliest governed official Actual work date.
 *
 * An ABSENT source falls through to the next one. A source whose truth is
 * broken — conflicting provenance, ambiguous plan context, a baseline that does
 * not bind, Actual truth that is incomplete or unproven — does NOT fall
 * through. Skipping a broken authority would quietly answer from weaker truth
 * while a stronger authority is in conflict, so it fails closed instead.
 */
export function resolveCalendarNavigatorStart(input: {
  workPeriodAnchor: WorkPeriodAnchorNavigatorStart;
  lockedPlanStart: LockedPlanNavigatorStart;
  earliestGovernedActual: GovernedActualNavigatorStart;
}): CalendarNavigatorStart {
  if (input.workPeriodAnchor.state === 'INVALID_PROVENANCE') {
    return {
      state: 'UNAVAILABLE',
      reason: 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
    };
  }
  if (input.workPeriodAnchor.state === 'PROVEN') {
    return {
      state: 'RESOLVED',
      startDate: input.workPeriodAnchor.anchorDate,
    };
  }

  if (input.lockedPlanStart.state === 'UNAVAILABLE') {
    return { state: 'UNAVAILABLE', reason: input.lockedPlanStart.reason };
  }
  if (input.lockedPlanStart.state === 'RESOLVED') {
    return { state: 'RESOLVED', startDate: input.lockedPlanStart.startDate };
  }

  if (input.earliestGovernedActual.state === 'UNAVAILABLE') {
    return {
      state: 'UNAVAILABLE',
      reason: input.earliestGovernedActual.reason,
    };
  }
  if (input.earliestGovernedActual.state === 'RESOLVED') {
    return {
      state: 'RESOLVED',
      startDate: input.earliestGovernedActual.workDate,
    };
  }

  return {
    state: 'UNAVAILABLE',
    reason: 'EARLIEST_AUTHORITATIVE_EXECUTION_DATE_UNAVAILABLE',
  };
}

/**
 * The earliest work date among governed eligible Current Official facts.
 *
 * Only facts the canonical governance already admitted may speak. Items with
 * nothing recorded contribute no candidate; an item whose truth is incomplete,
 * lineage-invalid, numerically invalid or semantically unproven fails the whole
 * answer closed, because an "earliest official execution date" claimed while
 * the official picture is unsettled would be a guess wearing a fact's clothes.
 */
export function resolveEarliestGovernedActualWorkDate(
  results: readonly CurrentGovernedOfficialFactsResult[],
): GovernedActualNavigatorStart {
  let earliest: string | null = null;

  for (const result of results) {
    switch (result.state) {
      case 'NOT_YET_RECORDED':
      case 'NO_ELIGIBLE_CURRENT_FACT':
        continue;
      case 'INVALID_LINEAGE':
        return { state: 'UNAVAILABLE', reason: 'ACTUAL_LINEAGE_INVALID' };
      case 'INVALID_NUMERIC_FACT':
        return { state: 'UNAVAILABLE', reason: 'ACTUAL_NUMERIC_FACT_INVALID' };
      case 'SEMANTICS_UNPROVEN':
        return { state: 'UNAVAILABLE', reason: 'ACTUAL_SEMANTICS_UNPROVEN' };
      case 'INCOMPLETE':
        return { state: 'UNAVAILABLE', reason: 'ACTUAL_TRUTH_INCOMPLETE' };
      case 'COMPLETE': {
        for (const fact of result.eligibleCurrentFacts) {
          const wire = workDateWire(fact.entry.workDate);
          if (wire === null) {
            return {
              state: 'UNAVAILABLE',
              reason: 'ACTUAL_WORK_DATE_MISSING',
            };
          }
          if (earliest === null || wire < earliest) earliest = wire;
        }
        continue;
      }
    }
  }

  return earliest === null
    ? { state: 'ABSENT' }
    : { state: 'RESOLVED', workDate: earliest };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY LAW
// ─────────────────────────────────────────────────────────────────────────────

export type MonitoringPeriodNavigatorQueryError =
  | 'AMBIGUOUS_PERIOD_NAVIGATOR'
  | 'INVALID_INCLUDE_PERIOD_NAVIGATOR'
  | 'PERIOD_NAVIGATOR_FIELDS_REQUIRE_OPT_IN'
  | 'PERIOD_NAVIGATOR_REQUIRES_GRANULARITY'
  | 'INVALID_PERIOD_NAVIGATOR_GRANULARITY'
  | 'PERIOD_NAVIGATOR_REQUIRES_BASIS'
  | 'INVALID_PERIOD_NAVIGATOR_BASIS'
  | 'INVALID_PERIOD_NAVIGATOR_CURSOR';

export type MonitoringPeriodNavigatorInput = {
  basis: TemporalBasis;
  granularity: TemporalGranularity;
  /** A server-issued continuation date, echoed back verbatim by the client. */
  cursor?: string;
};

export type MonitoringPeriodNavigatorQueryResolution =
  | { state: 'DISABLED' }
  | { state: 'ENABLED'; input: MonitoringPeriodNavigatorInput }
  | { state: 'INVALID'; reason: MonitoringPeriodNavigatorQueryError };

const periodNavigatorQueryKeys = [
  'includePeriodNavigator',
  'periodNavigatorGranularity',
  'periodNavigatorBasis',
  'periodNavigatorCursor',
] as const;

/**
 * Strict opt-in parsing, matching the Temporal Lens query law: array/object
 * query shapes are ambiguous rather than coerced, the flag is exactly
 * `true`/`false`, and the navigator's own fields are refused unless it is on.
 * Absent opt-in leaves existing Monitoring behaviour untouched.
 *
 * One request asks for ONE basis, which is how the reader actually chooses:
 * Mingguan or Bulanan, then Waktu Kerja or Kalender. The cursor is optional and
 * is only ever a Project Business Date the server itself issued; its shape is
 * proved here, and whether it is lawful for THIS project is proved later
 * against the project's own horizon.
 */
export function parseMonitoringPeriodNavigatorQuery(
  query: Readonly<Record<string, unknown>>,
): MonitoringPeriodNavigatorQueryResolution {
  if (
    Object.keys(query).some((key) =>
      periodNavigatorQueryKeys.some((field) => key.startsWith(`${field}[`)),
    )
  ) {
    return { state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' };
  }

  const includeValue = query.includePeriodNavigator;
  if (includeValue !== undefined && typeof includeValue !== 'string') {
    return { state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' };
  }
  if (
    includeValue !== undefined &&
    includeValue !== 'true' &&
    includeValue !== 'false'
  ) {
    return { state: 'INVALID', reason: 'INVALID_INCLUDE_PERIOD_NAVIGATOR' };
  }

  const enabled = includeValue === 'true';
  const hasNavigatorFields =
    query.periodNavigatorGranularity !== undefined ||
    query.periodNavigatorBasis !== undefined ||
    query.periodNavigatorCursor !== undefined;
  if (!enabled) {
    return hasNavigatorFields
      ? { state: 'INVALID', reason: 'PERIOD_NAVIGATOR_FIELDS_REQUIRE_OPT_IN' }
      : { state: 'DISABLED' };
  }

  if (query.periodNavigatorGranularity === undefined) {
    return {
      state: 'INVALID',
      reason: 'PERIOD_NAVIGATOR_REQUIRES_GRANULARITY',
    };
  }
  if (typeof query.periodNavigatorGranularity !== 'string') {
    return { state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' };
  }
  if (
    !Object.values(TEMPORAL_GRANULARITY).includes(
      query.periodNavigatorGranularity as never,
    )
  ) {
    return {
      state: 'INVALID',
      reason: 'INVALID_PERIOD_NAVIGATOR_GRANULARITY',
    };
  }

  if (query.periodNavigatorBasis === undefined) {
    return { state: 'INVALID', reason: 'PERIOD_NAVIGATOR_REQUIRES_BASIS' };
  }
  if (typeof query.periodNavigatorBasis !== 'string') {
    return { state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' };
  }
  if (
    !Object.values(TEMPORAL_BASIS).includes(query.periodNavigatorBasis as never)
  ) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_NAVIGATOR_BASIS' };
  }

  const cursorValue = query.periodNavigatorCursor;
  if (cursorValue !== undefined && typeof cursorValue !== 'string') {
    return { state: 'INVALID', reason: 'AMBIGUOUS_PERIOD_NAVIGATOR' };
  }
  if (cursorValue !== undefined && !isProjectBusinessDateWire(cursorValue)) {
    return { state: 'INVALID', reason: 'INVALID_PERIOD_NAVIGATOR_CURSOR' };
  }

  return {
    state: 'ENABLED',
    input: {
      basis: query.periodNavigatorBasis as TemporalBasis,
      granularity: query.periodNavigatorGranularity as TemporalGranularity,
      ...(cursorValue === undefined ? {} : { cursor: cursorValue }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS LAW
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodNavigatorStatusUnavailableReason =
  | 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT'
  | 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE'
  | 'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED'
  | 'PROJECT_STATUS_NOT_SUPPORTED';

export type PeriodNavigatorStatusSupport =
  | { state: 'SUPPORTED' }
  | {
      state: 'UNAVAILABLE';
      reason: PeriodNavigatorStatusUnavailableReason;
    };

/**
 * Which project statuses have reporting periods at all.
 *
 * ACTIVE and ON_HOLD report against Project Business Today. PLANNED has not
 * started reporting — Monitoring is not a planning engine. COMPLETED and
 * CANCELLED would need a canonical terminal business date, which SIMPROK does
 * not yet hold; rather than run their navigator on to the present day, they say
 * so. ARCHIVED terminal semantics are not ratified.
 */
export function monitoringPeriodNavigatorStatusSupport(
  status: string,
): PeriodNavigatorStatusSupport {
  switch (status) {
    case 'ACTIVE':
    case 'ON_HOLD':
      return { state: 'SUPPORTED' };
    case 'PLANNED':
      return {
        state: 'UNAVAILABLE',
        reason: 'REPORTING_NOT_STARTED_FOR_PLANNED_PROJECT',
      };
    case 'COMPLETED':
    case 'CANCELLED':
      return {
        state: 'UNAVAILABLE',
        reason: 'TERMINAL_PROJECT_BUSINESS_DATE_NOT_AVAILABLE',
      };
    case 'ARCHIVED':
      return {
        state: 'UNAVAILABLE',
        reason: 'ARCHIVED_PROJECT_TERMINAL_SEMANTICS_NOT_RATIFIED',
      };
    default:
      return {
        state: 'UNAVAILABLE',
        reason: 'PROJECT_STATUS_NOT_SUPPORTED',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION SHAPE
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodNavigatorBasisUnavailableReason =
  | PeriodNavigatorStatusUnavailableReason
  | CanonicalTemporalPeriodEnumerationUnavailableReason
  | CalendarNavigatorStartUnavailableReason
  | 'PROJECT_NOT_FOUND'
  | 'NO_ACTIVE_BASELINE_CONTEXT'
  | 'PROJECT_TIME_ZONE_NOT_SET'
  | 'INVALID_PROJECT_TIME_ZONE'
  | 'INVALID_INSTANT'
  | 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID'
  | 'PERIOD_NAVIGATOR_CURSOR_AFTER_PROJECT_BUSINESS_TODAY'
  | 'PERIOD_NAVIGATOR_CURSOR_BEFORE_HORIZON_START';

export type MonitoringPeriodNavigatorProjection = {
  mode: typeof MONITORING_PERIOD_NAVIGATOR_MODE;
  basis: TemporalBasis;
  granularity: TemporalGranularity;
} & (
  | {
      state: 'RESOLVED';
      periods: CanonicalTemporalPeriod[];
      hasMoreOlder: boolean;
      olderCursor: string | null;
    }
  | { state: 'UNAVAILABLE'; reason: PeriodNavigatorBasisUnavailableReason }
);

/** The requested basis could not be served, and says exactly why. */
export function periodNavigatorUnavailable(
  basis: TemporalBasis,
  granularity: TemporalGranularity,
  reason: PeriodNavigatorBasisUnavailableReason,
): MonitoringPeriodNavigatorProjection {
  return {
    mode: MONITORING_PERIOD_NAVIGATOR_MODE,
    basis,
    granularity,
    state: 'UNAVAILABLE',
    reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION
// ─────────────────────────────────────────────────────────────────────────────

export type ResolveMonitoringPeriodNavigatorInput = {
  basis: TemporalBasis;
  granularity: TemporalGranularity;
  /** A server-issued continuation date; absent means the newest page. */
  cursor?: string;
  /** One wall-clock reading for the whole request. */
  requestInstant: Date;
  project: { status: string; timeZone: string | null } | null;
  hasActiveBaselineContext: boolean;
  workPeriodAnchor: WorkPeriodAnchorNavigatorStart;
  lockedPlanStart: LockedPlanNavigatorStart;
  earliestGovernedActual: GovernedActualNavigatorStart;
  /** Injected so the horizon end stays a pure function of the inputs. */
  projectBusinessDateAtInstant: (
    instant: Date,
    timeZone: string | null,
  ) =>
    | { state: 'RESOLVED'; businessDate: string }
    | {
        state: 'UNAVAILABLE';
        reason:
          | 'PROJECT_TIME_ZONE_NOT_SET'
          | 'INVALID_PROJECT_TIME_ZONE'
          | 'INVALID_INSTANT';
      };
};

/**
 * One bounded page of the requested basis, from project context to periods.
 *
 * The prerequisites are checked in the order that makes a refusal honest: the
 * project, its status, an active Baseline context, Project Business Today, then
 * the horizon start for the basis that was actually asked for.
 *
 * A cursor is untrusted even though the server issued it. It is refused — never
 * clamped, never reinterpreted — when it points past Today or before the
 * project's lawful horizon start, so a hand-edited cursor can neither invent
 * future reporting periods nor wander off the beginning of the project.
 */
export function resolveMonitoringPeriodNavigator(
  input: Readonly<ResolveMonitoringPeriodNavigatorInput>,
): MonitoringPeriodNavigatorProjection {
  const { basis, granularity } = input;
  const unavailable = (reason: PeriodNavigatorBasisUnavailableReason) =>
    periodNavigatorUnavailable(basis, granularity, reason);

  if (input.project === null) return unavailable('PROJECT_NOT_FOUND');

  const statusSupport = monitoringPeriodNavigatorStatusSupport(
    input.project.status,
  );
  if (statusSupport.state === 'UNAVAILABLE') {
    return unavailable(statusSupport.reason);
  }

  if (!input.hasActiveBaselineContext) {
    return unavailable('NO_ACTIVE_BASELINE_CONTEXT');
  }

  const today = input.projectBusinessDateAtInstant(
    input.requestInstant,
    input.project.timeZone,
  );
  if (today.state === 'UNAVAILABLE') return unavailable(today.reason);

  let horizonStartDate: string;
  let governedWorkPeriodAnchorDate: string | undefined;

  if (basis === TEMPORAL_BASIS.WORK_PERIOD) {
    if (input.workPeriodAnchor.state === 'NOT_PROVEN') {
      return unavailable('GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED');
    }
    if (input.workPeriodAnchor.state === 'INVALID_PROVENANCE') {
      return unavailable('WORK_PERIOD_ANCHOR_PROVENANCE_INVALID');
    }
    horizonStartDate = input.workPeriodAnchor.anchorDate;
    governedWorkPeriodAnchorDate = input.workPeriodAnchor.anchorDate;
  } else {
    const calendarStart = resolveCalendarNavigatorStart({
      workPeriodAnchor: input.workPeriodAnchor,
      lockedPlanStart: input.lockedPlanStart,
      earliestGovernedActual: input.earliestGovernedActual,
    });
    if (calendarStart.state === 'UNAVAILABLE') {
      return unavailable(calendarStart.reason);
    }
    horizonStartDate = calendarStart.startDate;
  }

  let pageEndDate = today.businessDate;
  if (input.cursor !== undefined) {
    if (input.cursor > today.businessDate) {
      return unavailable(
        'PERIOD_NAVIGATOR_CURSOR_AFTER_PROJECT_BUSINESS_TODAY',
      );
    }
    if (input.cursor < horizonStartDate) {
      return unavailable('PERIOD_NAVIGATOR_CURSOR_BEFORE_HORIZON_START');
    }
    pageEndDate = input.cursor;
  }

  const page = enumerateCanonicalTemporalPeriodPage({
    basis,
    granularity,
    horizonStartDate,
    pageEndDate,
    ...(governedWorkPeriodAnchorDate === undefined
      ? {}
      : { governedWorkPeriodAnchorDate }),
  });
  if (page.state === 'UNAVAILABLE') return unavailable(page.reason);

  return {
    mode: MONITORING_PERIOD_NAVIGATOR_MODE,
    basis,
    granularity,
    state: 'RESOLVED',
    periods: page.periods,
    hasMoreOlder: page.hasMoreOlder,
    olderCursor: page.olderCursor,
  };
}

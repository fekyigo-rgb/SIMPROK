/**
 * PROJECT BUSINESS TODAY — the civil calendar date, in the project's own time
 * zone, at an instant the caller supplies.
 *
 * SIMPROK already refuses to let wall-clock time impersonate a business fact.
 * This module keeps that separation honest for Monitoring's reporting horizon:
 * it converts an EXPLICIT instant into a Project Business Date using ONLY the
 * canonical `Project.timeZone`. There is no ambient clock here, no browser
 * zone, no operating-system zone, and no silent UTC fallback — a project whose
 * time zone is unset or unusable has no business date, and says so.
 *
 * `isSupportedProjectTimeZone` is the exact primitive ProjectService already
 * used inline to accept or reject a submitted zone. It lives here now so the
 * one rule serves both the governance command and this read path; the command's
 * external behaviour (`INVALID_PROJECT_TIME_ZONE`) is unchanged.
 */

/** Any instant is fine as the probe: validity depends on the zone, not the date. */
const TIME_ZONE_PROBE_INSTANT = new Date('2026-01-01T00:00:00.000Z');

/**
 * Whether the runtime accepts `value` as a time zone.
 *
 * This is the canonical Project time zone check. `Intl.DateTimeFormat` throws a
 * RangeError for anything it cannot resolve — including plausible-looking but
 * non-canonical strings such as `Browser/Local` — so acceptance here means the
 * zone can actually be used for a conversion later.
 */
export function isSupportedProjectTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(
      TIME_ZONE_PROBE_INSTANT,
    );
    return true;
  } catch {
    return false;
  }
}

export type ProjectBusinessDateUnavailableReason =
  /** `Project.timeZone` is null/blank — the project has no canonical zone yet. */
  | 'PROJECT_TIME_ZONE_NOT_SET'
  /** A stored zone the runtime cannot resolve. Never repaired, never guessed. */
  | 'INVALID_PROJECT_TIME_ZONE'
  /** The caller supplied an unusable instant. */
  | 'INVALID_INSTANT';

export type ProjectBusinessDateResolution =
  | { state: 'RESOLVED'; businessDate: string }
  | { state: 'UNAVAILABLE'; reason: ProjectBusinessDateUnavailableReason };

const pad = (value: number, length: number): string =>
  value.toString().padStart(length, '0');

/**
 * The Project Business Date (`YYYY-MM-DD`) at `instant` inside `projectTimeZone`.
 *
 * The date is assembled from explicitly requested numeric parts rather than by
 * parsing a formatted string, so no locale can change the meaning of the
 * result: `calendar` and `numberingSystem` are pinned, and the year, month and
 * day are read back by name. A zone that is absent or unusable fails closed.
 *
 * Pure and deterministic: the same (instant, zone) pair always yields the same
 * date, which is what makes it testable without a clock abstraction.
 */
export function projectBusinessDateAtInstant(
  instant: Date,
  projectTimeZone: string | null | undefined,
): ProjectBusinessDateResolution {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_INSTANT' };
  }

  const zone =
    typeof projectTimeZone === 'string' ? projectTimeZone.trim() : '';
  if (zone.length === 0) {
    return { state: 'UNAVAILABLE', reason: 'PROJECT_TIME_ZONE_NOT_SET' };
  }
  if (!isSupportedProjectTimeZone(zone)) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_PROJECT_TIME_ZONE' };
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      era: 'short',
    }).formatToParts(instant);
  } catch {
    return { state: 'UNAVAILABLE', reason: 'INVALID_PROJECT_TIME_ZONE' };
  }

  const partValue = (type: Intl.DateTimeFormatPartTypes): string | null =>
    parts.find((part) => part.type === type)?.value ?? null;

  const year = partValue('year');
  const month = partValue('month');
  const day = partValue('day');
  const era = partValue('era');
  if (year === null || month === null || day === null) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_PROJECT_TIME_ZONE' };
  }
  // A proleptic BC date cannot be written as a Project Business Date.
  if (era !== null && era !== 'AD') {
    return { state: 'UNAVAILABLE', reason: 'INVALID_INSTANT' };
  }

  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (
    !Number.isInteger(numericYear) ||
    !Number.isInteger(numericMonth) ||
    !Number.isInteger(numericDay) ||
    numericYear < 1 ||
    numericYear > 9999
  ) {
    return { state: 'UNAVAILABLE', reason: 'INVALID_INSTANT' };
  }

  return {
    state: 'RESOLVED',
    businessDate: `${pad(numericYear, 4)}-${pad(numericMonth, 2)}-${pad(numericDay, 2)}`,
  };
}

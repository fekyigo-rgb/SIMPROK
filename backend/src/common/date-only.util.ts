import { BadRequestException } from '@nestjs/common';

/**
 * RM02D2A2 remediation — exact YYYY-MM-DD calendar-date parsing, reusable
 * wherever SIMPROK needs a date-only (not timestamp) query contract.
 *
 * A bare `new Date(userInput)` is not an acceptable validator: it silently
 * rolls a calendar-invalid date forward (`new Date('2026-02-30')` becomes
 * 2026-03-02) and it accepts ISO8601 "basic format" strings (`'20260630'`)
 * that are spec-valid but not what this contract means by a date-only query.
 * Both are rejected here via an exact-format regex plus a round-trip check.
 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a strict "YYYY-MM-DD" string into the UTC instant at the start of
 * that calendar day. Throws BadRequestException (400) — never silently
 * corrects — when the string is not exactly this format, or when its
 * year/month/day do not round-trip to the same calendar date (catches
 * "2026-02-30", "2026-13-01", etc. before they can reach Prisma as a
 * different, silently-substituted date).
 */
export function parseDateOnlyUtc(value: string, fieldName: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new BadRequestException(
      `${fieldName} must be an exact calendar date in YYYY-MM-DD format`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${fieldName} is not a valid calendar date`);
  }

  return parsed;
}

/**
 * The UTC instant at the start of the day immediately after the given
 * UTC start-of-day instant — i.e. the exact exclusive upper bound for a
 * date-only "up to and including this day" filter (`lt`, never `lte` on a
 * midnight instant, which would only cover the first moment of the day).
 */
export function nextUtcDayStart(utcDayStart: Date): Date {
  return new Date(utcDayStart.getTime() + 24 * 60 * 60 * 1000);
}

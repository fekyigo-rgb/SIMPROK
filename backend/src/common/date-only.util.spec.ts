import { BadRequestException } from '@nestjs/common';
import { nextUtcDayStart, parseDateOnlyUtc } from './date-only.util';

describe('parseDateOnlyUtc', () => {
  it('parses a valid date to the UTC start of that calendar day', () => {
    expect(parseDateOnlyUtc('2026-06-30', 'dateFrom')).toEqual(
      new Date('2026-06-30T00:00:00.000Z'),
    );
  });

  it('accepts a valid leap day', () => {
    expect(parseDateOnlyUtc('2024-02-29', 'dateFrom')).toEqual(
      new Date('2024-02-29T00:00:00.000Z'),
    );
  });

  it('rejects a non-leap-year Feb 29 (never silently rolled to Mar 1)', () => {
    expect(() => parseDateOnlyUtc('2026-02-29', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a calendar-invalid date (never silently rolled forward)', () => {
    expect(() => parseDateOnlyUtc('2026-02-30', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an out-of-range month', () => {
    expect(() => parseDateOnlyUtc('2026-13-01', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an ISO8601 "basic format" string (ambiguous, not this date-only contract)', () => {
    expect(() => parseDateOnlyUtc('20260630', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a timestamp in a date-only field', () => {
    expect(() => parseDateOnlyUtc('2026-06-30T10:00:00Z', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a single-digit month/day (must be exactly two digits)', () => {
    expect(() => parseDateOnlyUtc('2026-6-30', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-date string', () => {
    expect(() => parseDateOnlyUtc('not-a-date', 'dateFrom')).toThrow(
      BadRequestException,
    );
  });

  it('includes the field name in the error so dateFrom/dateTo are distinguishable', () => {
    expect(() => parseDateOnlyUtc('bad', 'dateTo')).toThrow(/dateTo/);
  });
});

describe('nextUtcDayStart', () => {
  it('advances exactly one day within a month', () => {
    expect(nextUtcDayStart(parseDateOnlyUtc('2026-06-15', 'x'))).toEqual(
      new Date('2026-06-16T00:00:00.000Z'),
    );
  });

  it('rolls over a short month correctly (month rollover)', () => {
    expect(nextUtcDayStart(parseDateOnlyUtc('2026-04-30', 'x'))).toEqual(
      new Date('2026-05-01T00:00:00.000Z'),
    );
  });

  it('rolls over the year correctly (year rollover)', () => {
    expect(nextUtcDayStart(parseDateOnlyUtc('2026-12-31', 'x'))).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
  });

  it('rolls over a leap-day correctly', () => {
    expect(nextUtcDayStart(parseDateOnlyUtc('2024-02-29', 'x'))).toEqual(
      new Date('2024-03-01T00:00:00.000Z'),
    );
  });
});

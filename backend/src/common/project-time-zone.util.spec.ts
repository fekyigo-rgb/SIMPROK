import {
  isSupportedProjectTimeZone,
  projectBusinessDateAtInstant,
} from './project-time-zone.util';

/**
 * PROJECT BUSINESS TODAY.
 *
 * Every case here pins a FIXED instant. Nothing reads a clock, so these tests
 * are deterministic without fake timers — which is the whole reason the
 * conversion is a pure function taking the instant as an argument.
 */
describe('isSupportedProjectTimeZone', () => {
  it('accepts canonical IANA zones', () => {
    expect(isSupportedProjectTimeZone('Asia/Jakarta')).toBe(true);
    expect(isSupportedProjectTimeZone('Asia/Makassar')).toBe(true);
    expect(isSupportedProjectTimeZone('America/Los_Angeles')).toBe(true);
    expect(isSupportedProjectTimeZone('UTC')).toBe(true);
  });

  it('rejects the plausible-looking values a UI might invent', () => {
    expect(isSupportedProjectTimeZone('Browser/Local')).toBe(false);
    expect(isSupportedProjectTimeZone('Local')).toBe(false);
    expect(isSupportedProjectTimeZone('GMT+7')).toBe(false);
    expect(isSupportedProjectTimeZone('')).toBe(false);
  });
});

describe('projectBusinessDateAtInstant', () => {
  // A. One instant is two different civil dates depending on the project.
  it('A. the same instant is a different business date across a zone boundary', () => {
    const instant = new Date('2026-08-18T17:30:00.000Z');

    expect(projectBusinessDateAtInstant(instant, 'Asia/Jakarta')).toEqual({
      state: 'RESOLVED',
      businessDate: '2026-08-19',
    });
    expect(
      projectBusinessDateAtInstant(instant, 'America/Los_Angeles'),
    ).toEqual({ state: 'RESOLVED', businessDate: '2026-08-18' });
  });

  // B. The day turns at project midnight, not at UTC midnight.
  it('B. the business date turns exactly at project-local midnight', () => {
    expect(
      projectBusinessDateAtInstant(
        new Date('2026-08-18T16:59:59.999Z'),
        'Asia/Jakarta',
      ),
    ).toEqual({ state: 'RESOLVED', businessDate: '2026-08-18' });

    expect(
      projectBusinessDateAtInstant(
        new Date('2026-08-18T17:00:00.000Z'),
        'Asia/Jakarta',
      ),
    ).toEqual({ state: 'RESOLVED', businessDate: '2026-08-19' });
  });

  // C. Gregorian year and month boundaries are carried, not clipped.
  it('C. crosses Gregorian year and month boundaries in the project zone', () => {
    expect(
      projectBusinessDateAtInstant(
        new Date('2025-12-31T17:00:00.000Z'),
        'Asia/Jakarta',
      ),
    ).toEqual({ state: 'RESOLVED', businessDate: '2026-01-01' });

    expect(
      projectBusinessDateAtInstant(
        new Date('2026-01-31T17:00:00.000Z'),
        'Asia/Jakarta',
      ),
    ).toEqual({ state: 'RESOLVED', businessDate: '2026-02-01' });

    // Same UTC instant, still the old year in a western zone.
    expect(
      projectBusinessDateAtInstant(
        new Date('2025-12-31T17:00:00.000Z'),
        'America/Los_Angeles',
      ),
    ).toEqual({ state: 'RESOLVED', businessDate: '2025-12-31' });
  });

  it('pads single-digit month and day to an exact YYYY-MM-DD', () => {
    const resolution = projectBusinessDateAtInstant(
      new Date('2026-03-05T04:00:00.000Z'),
      'Asia/Jakarta',
    );
    expect(resolution).toEqual({
      state: 'RESOLVED',
      businessDate: '2026-03-05',
    });
    if (resolution.state === 'RESOLVED') {
      expect(resolution.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // D. No zone, no business date.
  it('D. a project without a time zone has no business date', () => {
    const instant = new Date('2026-08-18T17:30:00.000Z');
    for (const missing of [null, undefined, '', '   ']) {
      expect(projectBusinessDateAtInstant(instant, missing)).toEqual({
        state: 'UNAVAILABLE',
        reason: 'PROJECT_TIME_ZONE_NOT_SET',
      });
    }
  });

  // E. A legacy/invalid stored zone fails closed and is never repaired.
  it('E. an unusable stored time zone fails closed', () => {
    const instant = new Date('2026-08-18T17:30:00.000Z');
    for (const invalid of ['Browser/Local', 'Local', 'Not/AZone', 'GMT+7']) {
      expect(projectBusinessDateAtInstant(instant, invalid)).toEqual({
        state: 'UNAVAILABLE',
        reason: 'INVALID_PROJECT_TIME_ZONE',
      });
    }
  });

  it('an unusable instant fails closed', () => {
    expect(
      projectBusinessDateAtInstant(new Date('nonsense'), 'Asia/Jakarta'),
    ).toEqual({ state: 'UNAVAILABLE', reason: 'INVALID_INSTANT' });
  });

  // H + I. The only zone that can speak is the project's own.
  it('H+I. never falls back to UTC, to the host zone, or to any default', () => {
    const instant = new Date('2026-08-18T17:30:00.000Z');

    // UTC is a real answer ONLY when the project actually declares UTC.
    expect(projectBusinessDateAtInstant(instant, 'UTC')).toEqual({
      state: 'RESOLVED',
      businessDate: '2026-08-18',
    });

    // Missing or invalid never silently becomes UTC — it stays unavailable.
    expect(projectBusinessDateAtInstant(instant, null).state).toBe(
      'UNAVAILABLE',
    );
    expect(
      projectBusinessDateAtInstant(instant, 'Browser/Local').state,
    ).toBe('UNAVAILABLE');

    // The host's own zone has no vote: an explicit zone always decides.
    const jakarta = projectBusinessDateAtInstant(instant, 'Asia/Jakarta');
    const losAngeles = projectBusinessDateAtInstant(
      instant,
      'America/Los_Angeles',
    );
    expect(jakarta).not.toEqual(losAngeles);
  });

  it('is deterministic: the same inputs always give the same date', () => {
    const instant = new Date('2026-08-18T17:30:00.000Z');
    const first = projectBusinessDateAtInstant(instant, 'Asia/Jakarta');
    const second = projectBusinessDateAtInstant(instant, 'Asia/Jakarta');
    expect(first).toEqual(second);
  });
});

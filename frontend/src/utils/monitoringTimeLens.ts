import type { MonitoringTemporalGranularity } from './monitoringCurrent.ts';

/**
 * PRIMARY TIME LENS — presentation mapping only.
 *
 * SATU PROYEK. SATU STRUKTUR RAB. SATU PROGRESS TRUTH. BANYAK JENDELA WAKTU.
 *
 * The user-facing model of the Smart Monitoring Table is three windows onto the
 * same canonical project truth: TERKINI, MINGGUAN, BULANAN. There is no
 * user-facing generic "PERIODIK" lens, and there is no separate Weekly report
 * and no separate Monthly report — Mingguan and Bulanan are the same table
 * asking the same canonical Temporal Lens for a different granularity.
 *
 * Internally the page keeps the existing temporal context mode and granularity
 * exactly as the canonical request engine already expects them. This module is
 * the pure, total mapping between the two, and nothing else: it performs no
 * period boundary arithmetic, no progress or weight calculation, no date
 * inference, and it issues no request of its own. The single canonical request
 * path remains `monitoringTemporalLensRequestPath`.
 */
export type MonitoringTimeLens = 'TERKINI' | 'MINGGUAN' | 'BULANAN';

export type MonitoringTemporalContextMode = 'TERKINI' | 'PERIODIK';

export interface MonitoringTimeLensState {
  mode: MonitoringTemporalContextMode;
  granularity: MonitoringTemporalGranularity;
}

/** Every primary lens the Smart Monitoring Table offers, in Owner order. */
export const MONITORING_TIME_LENSES: readonly MonitoringTimeLens[] = [
  'TERKINI',
  'MINGGUAN',
  'BULANAN',
];

/** The lens the Smart Monitoring Table opens on. */
export const DEFAULT_MONITORING_TIME_LENS: MonitoringTimeLens = 'TERKINI';

/**
 * Which primary lens the current internal state is showing.
 *
 * The internal granularity is retained while TERKINI is active so that
 * returning to a periodic window does not silently re-open a different one.
 */
export function monitoringTimeLensOf(
  state: MonitoringTimeLensState,
): MonitoringTimeLens {
  if (state.mode === 'TERKINI') return 'TERKINI';
  return state.granularity === 'MONTH' ? 'BULANAN' : 'MINGGUAN';
}

/**
 * The internal state a chosen primary lens asks for.
 *
 * TERKINI carries the granularity forward untouched rather than resetting it,
 * so TERKINI → BULANAN → TERKINI → (periodic) returns to BULANAN.
 */
export function monitoringTimeLensState(
  lens: MonitoringTimeLens,
  currentGranularity: MonitoringTemporalGranularity,
): MonitoringTimeLensState {
  switch (lens) {
    case 'TERKINI':
      return { mode: 'TERKINI', granularity: currentGranularity };
    case 'MINGGUAN':
      return { mode: 'PERIODIK', granularity: 'WEEK' };
    case 'BULANAN':
      return { mode: 'PERIODIK', granularity: 'MONTH' };
  }
}

/** Whether a lens reads a canonical period window rather than current truth. */
export function monitoringTimeLensIsPeriodic(lens: MonitoringTimeLens): boolean {
  return lens !== 'TERKINI';
}

/**
 * Periodic windows are read-only. Recording or managing an Actual is a Current
 * capability, so no Actual mutation door is offered under MINGGUAN or BULANAN.
 */
export function monitoringTimeLensAllowsActualAction(
  lens: MonitoringTimeLens,
): boolean {
  return lens === 'TERKINI';
}

/** Human label for the primary lens control. */
export function monitoringTimeLensLabel(lens: MonitoringTimeLens): string {
  switch (lens) {
    case 'TERKINI':
      return 'TERKINI';
    case 'MINGGUAN':
      return 'MINGGUAN';
    case 'BULANAN':
      return 'BULANAN';
  }
}

/** What the lens reads, said plainly under the control. */
export function monitoringTimeLensDescription(lens: MonitoringTimeLens): string {
  switch (lens) {
    case 'TERKINI':
      return 'Kondisi resmi proyek saat ini.';
    case 'MINGGUAN':
      return 'Struktur RAB yang sama, dibaca pada satu minggu kanonikal.';
    case 'BULANAN':
      return 'Struktur RAB yang sama, dibaca pada satu bulan kanonikal.';
  }
}

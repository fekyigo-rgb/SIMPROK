import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MONITORING_TIME_LENS,
  MONITORING_TIME_LENSES,
  monitoringTimeLensAllowsActualAction,
  monitoringTimeLensDescription,
  monitoringTimeLensIsPeriodic,
  monitoringTimeLensLabel,
  monitoringTimeLensOf,
  monitoringTimeLensState,
  type MonitoringTimeLens,
} from './monitoringTimeLens.ts';
import { monitoringTemporalLensRequestPath } from './monitoringCurrent.ts';

/**
 * PRIMARY TIME LENS — behavioural half of the Owner law.
 *
 * SATU PROYEK. SATU STRUKTUR RAB. SATU PROGRESS TRUTH. BANYAK JENDELA WAKTU.
 *
 * The structural half — that the page renders exactly one Smart Monitoring
 * Table, that no separate Laporan Mingguan or Laporan Bulanan door exists, and
 * that no second request engine was introduced — lives in
 * pages/field/monitoringWorkspaceLaw.test.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The three windows, and only the three windows
// ─────────────────────────────────────────────────────────────────────────────

test('1. the Smart Monitoring Table opens on TERKINI', () => {
  assert.equal(DEFAULT_MONITORING_TIME_LENS, 'TERKINI');
  assert.equal(
    monitoringTimeLensOf(monitoringTimeLensState('TERKINI', 'WEEK')),
    'TERKINI',
  );
});

test('4. the user-facing model is exactly TERKINI / MINGGUAN / BULANAN — no generic PERIODIK lens', () => {
  assert.deepEqual([...MONITORING_TIME_LENSES], [
    'TERKINI',
    'MINGGUAN',
    'BULANAN',
  ]);
  for (const lens of MONITORING_TIME_LENSES) {
    assert.notEqual(monitoringTimeLensLabel(lens), 'PERIODIK');
    assert.equal(monitoringTimeLensLabel(lens), lens);
  }
});

test('the mapping is total and round-trips every lens', () => {
  for (const lens of MONITORING_TIME_LENSES) {
    const state = monitoringTimeLensState(lens, 'WEEK');
    assert.equal(monitoringTimeLensOf(state), lens);
    assert.ok(monitoringTimeLensDescription(lens).length > 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MINGGUAN and BULANAN are the existing Temporal Lens, at a granularity
// ─────────────────────────────────────────────────────────────────────────────

test('2. MINGGUAN asks the canonical Temporal Lens for granularity WEEK', () => {
  const state = monitoringTimeLensState('MINGGUAN', 'MONTH');
  assert.deepEqual(state, { mode: 'PERIODIK', granularity: 'WEEK' });

  const path = monitoringTemporalLensRequestPath({
    projectId: 'p1',
    basis: 'WORK_PERIOD',
    granularity: state.granularity,
    referenceDate: '2026-03-04',
  });
  assert.ok(path.includes('temporalGranularity=WEEK'));
  assert.ok(path.includes('includeTemporalLens=true'));
});

test('3. BULANAN asks the canonical Temporal Lens for granularity MONTH', () => {
  const state = monitoringTimeLensState('BULANAN', 'WEEK');
  assert.deepEqual(state, { mode: 'PERIODIK', granularity: 'MONTH' });

  const path = monitoringTemporalLensRequestPath({
    projectId: 'p1',
    basis: 'CALENDAR',
    granularity: state.granularity,
    referenceDate: '2026-03-04',
  });
  assert.ok(path.includes('temporalGranularity=MONTH'));
  assert.ok(path.includes('includeTemporalLens=true'));
});

test('both periodic windows reach the same single canonical request path', () => {
  const paths = (['MINGGUAN', 'BULANAN'] as const).map((lens) =>
    monitoringTemporalLensRequestPath({
      projectId: 'p1',
      basis: 'WORK_PERIOD',
      granularity: monitoringTimeLensState(lens, 'WEEK').granularity,
      referenceDate: '2026-03-04',
    }).split('?')[0],
  );
  assert.deepEqual(paths, [
    '/projects/p1/progress/monitoring',
    '/projects/p1/progress/monitoring',
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Switching windows
// ─────────────────────────────────────────────────────────────────────────────

test('13. MINGGUAN <-> BULANAN stays periodic, so the reference date is never discarded', () => {
  assert.equal(monitoringTimeLensState('MINGGUAN', 'MONTH').mode, 'PERIODIK');
  assert.equal(monitoringTimeLensState('BULANAN', 'WEEK').mode, 'PERIODIK');
  assert.ok(monitoringTimeLensIsPeriodic('MINGGUAN'));
  assert.ok(monitoringTimeLensIsPeriodic('BULANAN'));
  assert.equal(monitoringTimeLensIsPeriodic('TERKINI'), false);
});

test('returning to TERKINI carries the periodic window forward rather than resetting it', () => {
  assert.equal(monitoringTimeLensState('TERKINI', 'MONTH').granularity, 'MONTH');
  assert.equal(monitoringTimeLensState('TERKINI', 'WEEK').granularity, 'WEEK');
});

// ─────────────────────────────────────────────────────────────────────────────
// Action hierarchy
// ─────────────────────────────────────────────────────────────────────────────

test('15. a periodic window is read-only — no Actual mutation door', () => {
  assert.equal(monitoringTimeLensAllowsActualAction('MINGGUAN'), false);
  assert.equal(monitoringTimeLensAllowsActualAction('BULANAN'), false);
});

test('16. the Actual door belongs to TERKINI', () => {
  assert.equal(monitoringTimeLensAllowsActualAction('TERKINI'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// No frontend business math hides in the mapping
// ─────────────────────────────────────────────────────────────────────────────

test('the lens mapping computes no boundary, quantity, weight, or percentage', () => {
  const source = MONITORING_TIME_LENSES.map((lens: MonitoringTimeLens) =>
    JSON.stringify(monitoringTimeLensState(lens, 'WEEK')),
  ).join('|');

  // Every produced value is one of the canonical enum members the backend
  // already defines. Nothing is derived, summed, prorated, or dated here.
  assert.equal(/\d/.test(source), false, 'the mapping produced a number');
});

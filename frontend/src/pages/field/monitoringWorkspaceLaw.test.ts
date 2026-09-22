import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * MONITORING WORKSPACE LAW — structural guards.
 *
 * This page has no DOM test harness in this repo, and adding one would mean
 * adding a dependency nobody asked for. So the laws that are structural facts
 * about the JSX are asserted against the source itself, the same way
 * pages/ownerUiLaw.test.ts does: which control carries which handler, which
 * door exists at all, and which sentence can be reached in which state.
 *
 * The behavioural half of the time-lens law lives in
 * utils/monitoringTimeLens.test.ts.
 *
 * THE LAW THESE GUARD
 *   SATU PROYEK. SATU STRUKTUR RAB. SATU PROGRESS TRUTH. BANYAK JENDELA WAKTU.
 *   Monitoring presents canonical truth. It calculates none of it.
 */

const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
const plan = readFileSync('src/pages/field/ExecutionPlanReadinessPanel.tsx', 'utf8');
const css = readFileSync('src/pages/field/ProjectWorkPage.css', 'utf8');
const lens = readFileSync('src/utils/monitoringTimeLens.ts', 'utf8');

/** Occurrences of `needle` in `source`. */
const countOf = (source: string, needle: string) =>
  source.split(needle).length - 1;

// ─────────────────────────────────────────────────────────────────────────────
// A. ONE SMART MONITORING TABLE, THREE WINDOWS
// ─────────────────────────────────────────────────────────────────────────────

test('1. the primary time lens defaults to TERKINI through the canonical default', () => {
  assert.ok(
    page.includes('useState<TemporalContextMode>(DEFAULT_TIME_LENS_STATE.mode)'),
    'the opening context mode is not taken from the canonical default lens',
  );
  assert.ok(
    page.includes(
      'monitoringTimeLensState(\n  DEFAULT_MONITORING_TIME_LENS,',
    ),
    'the default state is not derived from DEFAULT_MONITORING_TIME_LENS',
  );
  assert.ok(
    page.includes("useState<MonitoringContentLens>('VISUAL')"),
    'the initial contextual lens is not VISUAL',
  );
});

test('4. the primary lens control offers no generic PERIODIK button', () => {
  const control = page.slice(
    page.indexOf('className="h2a0-time-lens"'),
    page.indexOf('const monitoringLensSelector'),
  );
  const primaryButtons = control.slice(
    control.indexOf('{MONITORING_TIME_LENSES.map'),
    control.indexOf("{periodMenuOpen && temporalContextMode === 'PERIODIK'"),
  );
  const primaryLensList = lens.match(
    /export const MONITORING_TIME_LENSES:[\s\S]*?= \[([\s\S]*?)\];/,
  );
  assert.notEqual(control.length, 0, 'the time lens control is missing');
  assert.ok(
    control.includes('MONITORING_TIME_LENSES.map'),
    'the lens buttons are not driven by the canonical lens list',
  );
  assert.ok(
    control.includes('monitoringTimeLensLabel(lens)'),
    'the lens buttons do not use the canonical labels',
  );
  assert.notEqual(primaryButtons.length, 0, 'the primary lens buttons are missing');
  assert.ok(primaryLensList, 'the canonical primary lens list is missing');
  assert.deepEqual(
    Array.from(primaryLensList[1].matchAll(/'([^']+)'/g), (match) => match[1]),
    ['TERKINI', 'MINGGUAN', 'BULANAN'],
    'the canonical primary lens list exposes another user-facing mode',
  );
  assert.equal(
    countOf(primaryButtons, 'PERIODIK'),
    0,
    'a generic PERIODIK lens is offered to the user',
  );
});

test('9. exactly one Smart Monitoring Table shell serves all three windows', () => {
  assert.equal(
    countOf(page, 'className="h2a0-anchor"'),
    1,
    'more than one Monitoring table anchor exists',
  );
  assert.equal(
    countOf(page, "'h2a0-table is-periodic'"),
    1,
    'the periodic window does not reuse the one table shell',
  );
  assert.equal(
    countOf(page, '<table className'),
    1,
    'a second Monitoring table was introduced',
  );
  // The lens control belongs to the table itself, not to a page-level strip.
  const anchor = page.indexOf('className="h2a0-anchor"');
  assert.ok(
    page.indexOf('{timeLensSelector}') > anchor,
    'the primary time lens does not belong to the Smart Monitoring Table',
  );
});

test('5 + 6. basis and server periods stay inside the on-demand lens menu', () => {
  const control = page.slice(
    page.indexOf('className="h2a0-time-lens"'),
    page.indexOf('const monitoringLensSelector'),
  );
  assert.notEqual(control.length, 0, 'the period lens control is missing');
  assert.equal(
    page.includes('className="h2a0-period-controls"'),
    false,
    'a standalone period-control row remains permanently exposed',
  );
  assert.ok(
    control.includes("periodMenuOpen && temporalContextMode === 'PERIODIK'"),
    'the nested period menu is not gated by the open periodic lens',
  );
  assert.ok(control.includes('Waktu Kerja'), 'Waktu Kerja basis is missing');
  assert.ok(control.includes('Kalender'), 'Kalender basis is missing');
  assert.ok(
    control.includes('activePeriodNavigatorPresentation.periods.map') &&
      control.includes('selectNavigatorPeriod(period)'),
    'the selector is not populated by the backend Period Navigator',
  );
  assert.equal(
    control.includes('type="date"'),
    false,
    'a local date input bypasses the server-issued period identities',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B. NO SECOND ENGINE, NO SEPARATE WEEKLY/MONTHLY MODULE
// ─────────────────────────────────────────────────────────────────────────────

test('7 + 8. no separate Laporan Mingguan or Laporan Bulanan module, card, or door', () => {
  for (const forbidden of ['Laporan Mingguan', 'Laporan Bulanan', 'Laporan Harian']) {
    assert.equal(
      countOf(page, forbidden),
      0,
      `${forbidden} is exposed as a Monitoring door`,
    );
    assert.equal(countOf(plan, forbidden), 0, `${forbidden} leaked into the plan panel`);
  }
});

test('10. no second Monitoring request engine was introduced', () => {
  // Every Monitoring request path is built by the canonical helpers.
  assert.equal(
    countOf(page, 'monitoringTemporalLensRequestPath({'),
    1,
    'the Temporal Lens is requested from somewhere other than the one call site',
  );
  assert.equal(
    countOf(page, "'/progress/monitoring"),
    0,
    'a Monitoring path is hand-built instead of using the canonical helper',
  );
  assert.equal(
    countOf(page, 'progress/monitoring?'),
    0,
    'a Monitoring query string is hand-built in the page',
  );
});

test('the page performs no period, weight, progress, or deviation arithmetic', () => {
  // The lens mapping is the only new logic, and it is a pure enum mapping.
  for (const forbidden of [
    'new Date(',
    'Date.now(',
    'getTimezoneOffset',
    'Intl.DateTimeFormat',
    'parseFloat(',
    'Number(',
  ]) {
    assert.equal(
      countOf(lens, forbidden),
      0,
      `the time lens mapping reaches for ${forbidden}`,
    );
  }
  assert.equal(
    countOf(lens, 'fetch'),
    0,
    'the time lens mapping issues a request of its own',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// C. SELECTED WORK_ITEM DRIVES THE CONTEXTUAL DETAIL WORKSPACE
// ─────────────────────────────────────────────────────────────────────────────

test('11. selecting a WORK_ITEM row drives the right contextual workspace', () => {
  assert.ok(
    page.includes('onClick={() => setSelectedId(row.id)}'),
    'the row is not the control that selects a WORK_ITEM',
  );
  assert.ok(
    page.includes('selectedWorkItem(rows, selectedId)'),
    'selection is not resolved through the canonical selector',
  );
  assert.ok(
    page.includes("className={`${isSelected ? 'is-selected' : ''}"),
    'the selected row carries no visible selected state',
  );
  assert.ok(
    /\.h2a0-table tr\.is-selected td \{/.test(css),
    'the selected row has no visual treatment',
  );
  // Selection does not navigate away.
  const rowSelect = page.slice(
    page.indexOf('className="h2a0-row-select"'),
    page.indexOf('</button>', page.indexOf('className="h2a0-row-select"')),
  );
  assert.equal(countOf(rowSelect, 'navigate('), 0, 'selecting a row navigates away');
});

test('12 + 13. neither the contextual lens nor the time lens clears the selection', () => {
  const contentLens = page.slice(
    page.indexOf('const monitoringLensSelector'),
    page.indexOf('const monitoringPlanContent'),
  );
  assert.notEqual(contentLens.length, 0, 'the contextual lens selector is missing');
  assert.equal(
    countOf(contentLens, 'setSelectedId'),
    0,
    'switching Visual/Analisis/Jadwal clears the selected WORK_ITEM',
  );

  const timeLens = page.slice(
    page.indexOf('const selectTimeLens'),
    page.indexOf('let errorMessage'),
  );
  assert.notEqual(timeLens.length, 0, 'the time lens handler is missing');
  assert.equal(
    countOf(timeLens, 'setSelectedId'),
    0,
    'switching TERKINI/MINGGUAN/BULANAN clears the selected WORK_ITEM',
  );
  assert.equal(
    countOf(timeLens, 'setMonitoringContentLens'),
    0,
    'switching the time window resets Visual/Analisis/Jadwal',
  );
  assert.ok(
    timeLens.includes('setPeriodMenuOpen(true)'),
    'switching a periodic window does not expose its Period Navigator',
  );
});

test('14. the contextual workspace offers exactly Visual, Analisis, and Jadwal', () => {
  const contentLens = page.slice(
    page.indexOf('const monitoringLensSelector'),
    page.indexOf('const monitoringPlanContent'),
  );
  assert.equal(countOf(contentLens, '<button'), 3, 'the contextual lens count changed');
  for (const [label, state] of [
    ['Visual', 'VISUAL'],
    ['Analisis', 'ANALYSIS'],
    ['Jadwal', 'SCHEDULE'],
  ] as const) {
    assert.ok(
      new RegExp(`>\\s*${label}\\s*<`).test(contentLens),
      `${label} lens is missing`,
    );
    assert.ok(
      contentLens.includes(`setMonitoringContentLens('${state}')`),
      `${label} lens is not wired to the ${state} view`,
    );
  }
  // No unsupported mockup tab is rendered here, live or disabled.
  for (const fake of ['Diagram', 'Network', 'Batang', 'Lingkaran']) {
    assert.equal(countOf(contentLens, fake), 0, `a fake ${fake} tab was added`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// D. ACTION HIERARCHY — understanding before action
// ─────────────────────────────────────────────────────────────────────────────

test('15. a periodic window exposes no Actual mutation door', () => {
  assert.ok(
    page.includes('monitoringTimeLensAllowsActualAction(activeTimeLens) && ('),
    'the Actual door is not gated on the time lens',
  );
  assert.equal(
    countOf(page, 'h2a0-detail-action'),
    1,
    'more than one Actual door exists',
  );
});

test('16. the Actual door stands after the contextual facts and the inspection lenses', () => {
  const itemScope = page.slice(page.lastIndexOf('className="h2a0-item-scope"'));
  const facts = itemScope.indexOf('className="h2a0-facts"');
  const lensSelector = itemScope.indexOf('{monitoringLensSelector}');
  const action = itemScope.indexOf('h2a0-detail-action');

  assert.ok(facts !== -1 && lensSelector !== -1 && action !== -1);
  assert.ok(facts < lensSelector, 'the inspection lenses precede the contextual facts');
  assert.ok(
    lensSelector < action,
    'the Actual door is offered before Visual/Analisis/Jadwal inspection',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// E. EXECUTION PLAN — GOVERNANCE, NOT PAGE DOMINATOR
// ─────────────────────────────────────────────────────────────────────────────

test('17. a locked Rencana Pelaksanaan stays visible but stops dominating the page', () => {
  // The heavy pre-lock review table is unreachable once the plan is locked.
  assert.ok(
    plan.includes('{!locked && (\n        <div className="execution-plan-review">'),
    'the full Rencana Kerja review table still renders after the lock',
  );
  // Governance and provenance are not deleted.
  assert.ok(
    plan.includes('{locked && executionPlan.plan && ('),
    'locked governance facts were removed',
  );
  for (const fact of [
    'Plan Version',
    'Revision frozen',
    'Baseline Version',
    'Locked At',
    'Authority',
  ]) {
    assert.ok(plan.includes(`<dt>${fact}</dt>`), `${fact} governance fact was removed`);
  }
  assert.ok(
    plan.includes("locked ? 'execution-plan is-governance-compact'"),
    'the locked plan carries no compact governance presentation',
  );
  assert.ok(
    /\.execution-plan\.is-governance-compact \{/.test(css),
    'the compact governance presentation has no styling',
  );
});

test('18. bounded pre-lock completion, save, and lock capability is preserved', () => {
  for (const capability of [
    'canEditDraft',
    "hasPermission('EXECUTION_PLAN_EDIT')",
    "hasPermission('EXECUTION_PLAN_LOCK')",
    'Lengkapi Rencana Pelaksanaan',
    'Revisi Rencana',
    'Kunci Rencana Pelaksanaan',
    'Simpan Draft',
    'execution-plan-blockers',
  ]) {
    assert.ok(plan.includes(capability), `pre-lock capability ${capability} was removed`);
  }
});

test('21 + 22. Analysis and Schedule reuse the existing plan/comparator truth', () => {
  assert.ok(
    page.includes('presentation={monitoringPlanView}'),
    'the contextual Analisis/Jadwal views no longer reuse the existing panel',
  );
  assert.ok(
    plan.includes('monitoringComparisonChartProjection(comparison.points)'),
    'the Kurva no longer reuses the canonical comparator projection',
  );
  assert.ok(
    plan.includes('executionPlan.schedule.map'),
    'the Jadwal no longer reuses the Execution Plan schedule',
  );
  assert.equal(
    countOf(page, 'monitoringComparisonChartProjection'),
    0,
    'a second curve calculator was introduced in the page',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// F. EVIDENCE SAFETY
// ─────────────────────────────────────────────────────────────────────────────

test('19 + 20. evidence stays a user-initiated safe reference', () => {
  for (const unsafe of ['<img', '<video', '<iframe', 'background-image', 'preload']) {
    assert.equal(
      countOf(page, unsafe),
      0,
      `evidence is rendered through ${unsafe}, which fetches an arbitrary URL automatically`,
    );
  }
  assert.ok(
    page.includes('rel="noopener noreferrer"'),
    'evidence links lost their safe-reference attributes',
  );
  assert.ok(
    page.includes('monitoringEvidencePresentation('),
    'evidence no longer passes through the canonical safe-reference filter',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// G. NO DOOR WITHOUT A CAPABILITY, NO MOCKUP CONTENT HARD-CODED
// ─────────────────────────────────────────────────────────────────────────────

test('23. unsupported mockup features are not exposed as fake doors', () => {
  for (const fake of [
    'Recovery',
    'Simulasi',
    'Diagram Batang',
    'Diagram Lingkaran',
    'Diagram Alir',
    'Network Planning',
    'Export / Print',
    'Forecast Selesai',
    'Sisa Waktu',
    'Cashflow',
    'SMKK',
    'Logistik',
  ]) {
    assert.equal(countOf(page, fake), 0, `${fake} is exposed without a canonical capability`);
    assert.equal(countOf(plan, fake), 0, `${fake} is exposed in the plan panel`);
  }
});

test('no mockup example content is hard-coded', () => {
  for (const source of [page, plan, css, lens]) {
    for (const mockupValue of [
      'Budi Santoso',
      'PK-2024-017',
      'Nusantara',
      '48.750.000.000',
      'Konsultan MK',
    ]) {
      assert.equal(
        countOf(source, mockupValue),
        0,
        `mockup example content ${mockupValue} was hard-coded`,
      );
    }
  }
});

test('the project header shows only canonical project facts', () => {
  const header = page.slice(
    page.indexOf('className="h2a0-project-header"'),
    page.indexOf('</header>'),
  );
  assert.notEqual(header.length, 0, 'the project header is missing');
  assert.ok(header.includes('{project.name}'), 'the project name is not canonical');
  assert.ok(header.includes('{project.code}'), 'the project code is not canonical');
  assert.ok(header.includes('{project.status}'), 'the project status is not canonical');
  // Facts the mockup shows but canonical project truth on this page does not.
  for (const invented of ['Lokasi', 'Nilai Proyek', 'Provinsi']) {
    assert.equal(countOf(header, invented), 0, `${invented} was invented in the header`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// H. DESKTOP COMPOSITION
// ─────────────────────────────────────────────────────────────────────────────

test('the contextual detail workspace is a real workspace, not a narrow sidebar', () => {
  const workspace = /\.h2a0-workspace \{[^}]*grid-template-columns: minmax\(0, ([\d.]+)fr\) minmax\((\d+)px, ([\d.]+)fr\)/.exec(
    css,
  );
  assert.ok(workspace, 'the Monitoring workspace grid is missing');

  const leftFr = Number(workspace[1]);
  const rightMinPx = Number(workspace[2]);
  const rightFr = Number(workspace[3]);
  const rightShare = rightFr / (leftFr + rightFr);

  assert.ok(
    rightShare >= 0.38 && rightShare <= 0.42,
    `the contextual workspace takes ${(rightShare * 100).toFixed(1)}% of the width, outside the 38-42% target`,
  );
  assert.ok(
    rightMinPx >= 400,
    `the contextual workspace can shrink to ${rightMinPx}px, too narrow to inspect facts and charts`,
  );
});

test('26. no truth disappears at a small viewport', () => {
  const stacked = /@media \(max-width: 820px\) \{[\s\S]*?\n\}/.exec(css);
  assert.ok(stacked, 'the stacking breakpoint is missing');
  assert.ok(
    stacked[0].includes('.h2a0-workspace { grid-template-columns: 1fr; }'),
    'the contextual workspace does not stack below the table',
  );
  assert.equal(
    countOf(css, 'display: none'),
    0,
    'a Monitoring fact is hidden rather than stacked at a small viewport',
  );
});

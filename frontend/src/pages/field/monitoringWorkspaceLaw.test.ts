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

const readinessNativeMarkerRule =
  '.execution-plan-header-control > summary::-webkit-details-marker { display: none; }';

/**
 * The native WebKit disclosure marker is decorative here because the summary
 * owns one visible caret. Remove only that exact, readiness-scoped rule before
 * enforcing the stronger law that no Monitoring fact or control disappears.
 */
const withoutReadinessNativeMarkerRule = (source: string) =>
  source.replace(readinessNativeMarkerRule, '');

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
    page.includes("useState<MonitoringContentLens>('CONDITION')"),
    'the initial contextual lens is not Kondisi Proyek',
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
  for (const forbidden of ['Laporan Mingguan', 'Laporan Bulanan']) {
    assert.equal(
      countOf(page, forbidden),
      0,
      `${forbidden} is exposed as a Monitoring door`,
    );
    assert.equal(countOf(plan, forbidden), 0, `${forbidden} leaked into the plan panel`);
  }
  assert.equal(
    countOf(page, 'Lihat Kalender'),
    0,
    'a standalone Lihat Kalender control bypasses the nested period menu',
  );
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
    'switching Kondisi/Visual/Analisis/Jadwal clears the selected WORK_ITEM',
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
    'switching the time window resets Kondisi/Visual/Analisis/Jadwal',
  );
  assert.ok(
    timeLens.includes('setPeriodMenuOpen(true)'),
    'switching a periodic window does not expose its Period Navigator',
  );
});

test('14. the contextual workspace offers exactly four primary views and no Interaksi tab', () => {
  const contentLens = page.slice(
    page.indexOf('const monitoringLensSelector'),
    page.indexOf('const monitoringPlanContent'),
  );
  assert.equal(countOf(contentLens, '<button'), 4, 'the primary view count is not four');
  for (const [label, state] of [
    ['Kondisi Proyek', 'CONDITION'],
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
  assert.equal(countOf(contentLens, 'Interaksi'), 0, 'Interaksi was added as a primary tab');
  assert.match(contentLens, /className="h2a0-primary-view-nav"/);
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

test('16. the Actual door stays after contextual facts and only inside Kondisi', () => {
  const itemScope = page.slice(page.lastIndexOf('className="h2a0-item-scope"'));
  const conditionGate = itemScope.indexOf("monitoringContentLens === 'CONDITION'");
  const facts = itemScope.indexOf('className="h2a0-facts"');
  const action = itemScope.indexOf('h2a0-detail-action');

  assert.ok(conditionGate !== -1 && facts !== -1 && action !== -1);
  assert.ok(
    conditionGate < facts && facts < action,
    'the Actual door is not downstream of the Kondisi facts',
  );
  assert.ok(
    itemScope.includes(
      "monitoringContentLens === 'CONDITION' &&\n                monitoringTimeLensAllowsActualAction(activeTimeLens)",
    ),
    'the Actual door leaks into another primary view',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// E. EXECUTION PLAN — GOVERNANCE, NOT PAGE DOMINATOR
// ─────────────────────────────────────────────────────────────────────────────

test('17. Rencana Pelaksanaan is a compact header disclosure without losing governance truth', () => {
  const headerStart = page.indexOf('<header className="h2a0-project-header">');
  const headerEnd = page.indexOf('</header>', headerStart);
  const header = page.slice(headerStart, headerEnd);

  assert.ok(headerStart !== -1 && headerEnd !== -1, 'project header is missing');
  assert.ok(
    header.includes('<ExecutionPlanReadinessPanel') &&
      header.includes('presentation="GOVERNANCE"'),
    'the readiness control is not mounted in the project header',
  );
  assert.equal(
    countOf(page, 'presentation="GOVERNANCE"'),
    1,
    'the compact readiness control is missing or duplicated',
  );
  assert.doesNotMatch(
    header,
    /temporalContextMode|monitoringContentLens/,
    'the project-level readiness control is conditional on a time lens or right view',
  );
  assert.ok(
    plan.includes('<details className="execution-plan-header-control">') &&
      plan.includes('<summary aria-describedby="execution-plan-header-help">'),
    'the readiness facts are not disclosed from one accessible header control',
  );
  assert.ok(
    plan.includes('className="execution-plan execution-plan-header-detail"'),
    'the readiness detail surface is missing',
  );
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
    !plan.includes('Execution Readiness'),
    'the internal Execution Readiness label remains visible to users',
  );
  assert.ok(
    /\.execution-plan-header-control > summary \{/.test(css) &&
      /\.execution-plan-header-detail \{[^}]*position: absolute/.test(css),
    'the compact control or non-flowing detail presentation has no styling',
  );
  assert.ok(
    /summary:hover \.execution-plan-header-help,[\s\S]*summary:focus-visible \.execution-plan-header-help/.test(css),
    'the helper explanation is not available on both hover and keyboard focus',
  );
  assert.doesNotMatch(
    page.slice(headerEnd, page.indexOf('className="h2a0-workspace"', headerEnd)),
    /presentation="GOVERNANCE"/,
    'a standalone readiness row remains below the project header',
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

test('19. UI-01 preserves last-updated provenance, actions, and independent chart rendering', () => {
  const headerStart = page.indexOf('<header className="h2a0-project-header">');
  const headerEnd = page.indexOf('</header>', headerStart);
  const header = page.slice(headerStart, headerEnd);
  assert.match(
    header,
    /<dt>Terakhir diperbarui<\/dt>[\s\S]*<dd>\{lastRecorded\.value\}<\/dd>[\s\S]*lastRecorded\.basis/,
  );
  assert.match(plan, /role="region"[\s\S]*aria-label="Detail Rencana Pelaksanaan"/);
  assert.match(plan, /<h3>Rencana Kerja<\/h3>/);
  assert.match(plan, /Lengkapi Rencana Pelaksanaan/);
  assert.match(plan, /Kunci Rencana Pelaksanaan/);
  assert.match(page, /presentation=\{monitoringPlanView\}/);
  assert.match(plan, /monitoringComparisonChartProjection\(comparison\.points\)/);
  assert.match(css, /\.execution-plan-comparison-table \{ min-width: 36rem; \}/);
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

test('UI-02 closeout keeps Kurva and Jadwal guidance on demand without changing their truth', () => {
  const curve = plan.slice(
    plan.indexOf('function MonitoringComparisonCurve'),
    plan.indexOf('function PeriodicScheduleReadOnly'),
  );
  assert.equal(
    countOf(curve, 'Rencana, Realisasi, dan Deviasi berasal dari perbandingan temporal'),
    1,
    'the canonical Kurva guidance is missing or duplicated',
  );
  assert.doesNotMatch(
    curve,
    /<p className="execution-plan-note">\s*Rencana, Realisasi, dan Deviasi/,
    'Kurva guidance remains a permanent paragraph',
  );
  assert.equal(
    countOf(curve, '{...curveHelp.triggerProps}'),
    2,
    'Kurva help is not reachable from both its title and legend',
  );
  assert.match(curve, /<h3>[\s\S]*Kurva S[\s\S]*<\/h3>/);
  assert.match(curve, /aria-label="Legenda Kurva S"/);
  assert.match(curve, /role="tooltip"/);
  assert.match(curve, /monitoringComparisonChartProjection\(comparison\.points\)/);

  assert.equal(
    countOf(
      plan,
      'Waktu tetap berasal dari rencana resmi. Realisasi menampilkan fakta Current Official terkini, bukan Actual Start, Actual Finish, atau durasi aktual.',
    ),
    1,
    'current schedule guidance is missing or duplicated',
  );
  assert.equal(
    countOf(
      plan,
      'Tanggal rencana berasal dari Rencana Pelaksanaan resmi. Kuantitas periode dan kumulatif berasal dari konteks periode kanonikal yang dipilih, bukan progress, Actual Start, Actual Finish, atau durasi aktual.',
    ),
    1,
    'periodic schedule guidance is missing or duplicated',
  );
  assert.equal(countOf(plan, '<OnDemandHeadingHelp'), 2);
  assert.match(plan, /onMouseEnter: \(\) => setOpen\(true\)/);
  assert.match(plan, /onFocus: \(\) => setOpen\(true\)/);
  assert.match(plan, /onClick: \(\) =>/);
  assert.match(plan, /event\.key === 'Escape'/);
  assert.match(css, /\.execution-plan-help-popover \{[^}]*position: absolute/);
});

test('UI-03A removes only redundant Analisis and Jadwal labels while preserving selectors and content', () => {
  for (const redundantLabel of [
    'Perbandingan Proyek',
    'Analisis Proyek',
    'Schedule Periode',
  ]) {
    assert.equal(
      countOf(plan, redundantLabel),
      0,
      `${redundantLabel} remains permanently rendered`,
    );
  }

  const currentAnalysis = plan.slice(
    plan.indexOf("if (presentation === 'ANALYSIS')"),
    plan.indexOf('const beginRevision'),
  );
  assert.match(currentAnalysis, /aria-label="Analisis Kurva S"/);
  assert.doesNotMatch(
    currentAnalysis,
    /className="execution-plan-heading"/,
    'an empty current-analysis heading still consumes permanent space',
  );
  assert.match(currentAnalysis, /<MonitoringComparisonCurve/);
  assert.match(plan, /title="Jadwal Proyek"/);
  assert.equal(countOf(plan, 'title="Jadwal Proyek"'), 2);

  const selectors = page.slice(
    page.indexOf('const monitoringPlanWorkspace'),
    page.indexOf('return (', page.indexOf('const monitoringPlanWorkspace')),
  );
  assert.match(selectors, /<option value="CURVE">Kurva S<\/option>/);
  assert.match(selectors, /<option value="WORK_PROGRAM">Program Kerja<\/option>/);
});

test('periodic Analysis and Schedule context is disclosed from the compact period label', () => {
  for (const contextCopy of [
    'Schedule Rencana + Realisasi Periode',
    'Kurva S Rencana + Realisasi s.d. Akhir Periode',
  ]) {
    assert.equal(countOf(plan, contextCopy), 0);
    assert.equal(countOf(page, contextCopy), 1);
  }

  const periodicStart = page.indexOf("temporalContextMode === 'PERIODIK'");
  const periodicProjectScopeStart = page.indexOf(
    '<div className="h2a0-project-scope">',
    periodicStart,
  );
  const periodicProjectScopeEnd = page.indexOf(
    "{monitoringContentLens === 'CONDITION' && (<>",
    periodicProjectScopeStart,
  );
  assert.ok(periodicProjectScopeStart >= 0, 'periodic project scope start is missing');
  assert.ok(
    periodicProjectScopeEnd > periodicProjectScopeStart,
    'periodic project scope end does not follow its start',
  );
  const periodicProjectScope = page.slice(
    periodicProjectScopeStart,
    periodicProjectScopeEnd,
  );
  assert.ok(periodicProjectScope.length > 0, 'periodic project scope slice is empty');
  assert.match(periodicProjectScope, /monitoringPlanView === null \? \(/);
  assert.match(periodicProjectScope, /<details className="h2a0-period-context-help">/);
  assert.match(periodicProjectScope, /<summary[\s\S]*aria-describedby="h2a0-period-context-tooltip"/);
  assert.match(periodicProjectScope, /role="tooltip"/);
  assert.match(periodicProjectScope, /monitoringTemporalPeriodLabel\(periodicResolvedLens\.period\)/);
  assert.match(periodicProjectScope, /formatProjectBusinessDate\(periodicResolvedLens\.period\.startDate\)/);
  assert.match(periodicProjectScope, /formatProjectBusinessDate\(periodicResolvedLens\.period\.endDate\)/);

  assert.match(plan, /title="Jadwal Proyek"/);
  assert.match(plan, /execution-plan-heading-state-only/);
  assert.match(plan, /<strong className="execution-plan-state is-locked">Hanya baca<\/strong>/);
  assert.match(css, /\.h2a0-period-context-tooltip \{[^}]*position: absolute/);
  assert.match(css, /\.h2a0-period-context-tooltip \{[^}]*border: 1px solid #86efac/);
  assert.match(css, /\.h2a0-period-context-tooltip \{[^}]*background: #f0fdf4/);
  assert.match(css, /\.h2a0-period-context-tooltip \{[^}]*color: #166534/);
  assert.match(css, /\.h2a0-period-context-help > summary:hover \.h2a0-period-context-tooltip/);
  assert.match(css, /\.h2a0-period-context-help > summary:focus-visible \.h2a0-period-context-tooltip/);
  assert.match(css, /\.h2a0-period-context-help\[open\] \.h2a0-period-context-tooltip/);
});

// ─────────────────────────────────────────────────────────────────────────────
// F. EVIDENCE SAFETY
// ─────────────────────────────────────────────────────────────────────────────

test('UI-02 table footer and support doors remain inside the one left workspace', () => {
  const anchor = page.slice(
    page.indexOf('<section className="h2a0-anchor"'),
    page.indexOf('<aside className="h2a0-current"'),
  );
  const footer = anchor.slice(anchor.indexOf('<tfoot>'), anchor.indexOf('</tfoot>'));
  assert.ok(anchor.includes('Daftar Uraian Pekerjaan Monitoring'));
  assert.ok(footer.includes('TOTAL PROYEK'), 'the project footer is missing');
  assert.ok(
    footer.includes('weightCompletenessLabel(activeMonitoringSnapshot.weight)') &&
      footer.includes('officialProjectProgressLabel('),
    'the footer is not rendering canonical weight/progress facts',
  );
  assert.ok(
    anchor.indexOf('className="h2a0-support-actions"') > anchor.indexOf('</table>'),
    'support actions are not below the table',
  );
});

test('UI-02 right shell keeps one scrollable viewport and a view-independent dock', () => {
  const asideStart = page.indexOf('<aside className="h2a0-current"');
  const aside = page.slice(asideStart, page.indexOf('</aside>', asideStart));
  const nav = aside.indexOf('{monitoringLensSelector}');
  const viewport = aside.indexOf('className="h2a0-right-viewport"');
  const dock = aside.indexOf('className="h2a0-interaction-dock"');
  assert.ok(nav !== -1 && viewport !== -1 && dock !== -1 && nav < viewport && viewport < dock);
  assert.equal(countOf(page, 'className="h2a0-interaction-dock"'), 1);
  assert.equal(countOf(aside, 'Tanyakan ke SIMPROK...'), 2);
  assert.match(css, /\.h2a0-current \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto[^}]*overflow: hidden/);
  assert.match(css, /\.h2a0-right-viewport \{[^}]*overflow-x: hidden[^}]*overflow-y: auto/);
});

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

test('23. unsupported features are either absent or explicitly disabled without fake routes', () => {
  for (const fake of [
    'Recovery',
    'Simulasi',
    'Diagram Alir',
    'Export / Print',
    'Forecast Selesai',
    'Sisa Waktu',
  ]) {
    assert.equal(countOf(page, fake), 0, `${fake} is exposed without a canonical capability`);
    assert.equal(countOf(plan, fake), 0, `${fake} is exposed in the plan panel`);
  }

  const support = page.slice(
    page.indexOf('<nav className="h2a0-support-actions"'),
    page.indexOf('</nav>', page.indexOf('<nav className="h2a0-support-actions"')),
  );
  assert.equal(countOf(support, '<button'), 4, 'the support door count is not four');
  assert.equal(countOf(support, ' disabled'), 4, 'a support door is falsely actionable');
  for (const label of ['Cashflow', 'Lap. SMKK', 'Laporan Harian', 'Logistik']) {
    assert.ok(support.includes(label), `${label} support door is missing`);
  }
  for (const forbiddenWire of ['navigate(', 'href=', 'onClick=']) {
    assert.equal(
      countOf(support, forbiddenWire),
      0,
      `a disabled support door is wired through ${forbiddenWire}`,
    );
  }

  const subselectors = page.slice(
    page.indexOf('const monitoringPlanWorkspace'),
    page.indexOf('return (', page.indexOf('const monitoringPlanWorkspace')),
  );
  assert.match(subselectors, /<option value="CURVE">Kurva S<\/option>/);
  assert.match(subselectors, /<option value="WORK_PROGRAM">Program Kerja<\/option>/);
  for (const unavailable of ['Diagram Lingkaran', 'Diagram Batang', 'Network Planning']) {
    assert.match(
      subselectors,
      new RegExp(`<option[^>]*disabled[^>]*>${unavailable}<\\/option>`),
      `${unavailable} is not truthfully disabled`,
    );
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
    countOf(css, readinessNativeMarkerRule),
    1,
    'the exact native marker exception is missing or duplicated',
  );
  assert.equal(
    countOf(withoutReadinessNativeMarkerRule(css), 'display: none'),
    0,
    'a Monitoring fact is hidden rather than stacked at a small viewport',
  );
  assert.match(
    css,
    /\.execution-plan-header-control > summary \{[^}]*display: flex/,
    'the real readiness summary control is not visible',
  );
  assert.match(
    css,
    /\.execution-plan-header-control > summary:focus-visible \{/,
    'the readiness summary has no keyboard focus treatment',
  );
  assert.match(
    css,
    /\.execution-plan-header-control\[open\] \.execution-plan-header-caret \{/,
    'the open disclosure has no visible marker state',
  );
  assert.match(
    plan,
    /<details className="execution-plan-header-control">[\s\S]*<summary aria-describedby="execution-plan-header-help">/,
    'the readiness marker is not attached to a native focusable disclosure',
  );

  for (const forbiddenRule of [
    '.execution-plan-header-control > summary { display: none; }',
    '.h2a0-time-lens { display: none; }',
    '.h2a0-table td { display: none; }',
    '.execution-plan-header-control > summary::-webkit-details-marker, .h2a0-time-lens { display: none; }',
  ]) {
    assert.equal(
      countOf(
        withoutReadinessNativeMarkerRule(`${css}\n${forbiddenRule}`),
        'display: none',
      ),
      1,
      `a real control/data rule was incorrectly exempted: ${forbiddenRule}`,
    );
  }
});

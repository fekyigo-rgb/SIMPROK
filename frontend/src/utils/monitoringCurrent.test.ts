import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  actualComparisonLabel,
  actualStateLabel,
  buildMonitoringRows,
  captureMethodLabel,
  dataThroughLabel,
  deviationComparisonPresentation,
  effectiveActual,
  formatWeightPercentage,
  lastRecordedLabel,
  lifecycleLabel,
  monitoringComparisonChartProjection,
  monitoringComparisonCutoff,
  monitoringComparisonRequestPath,
  monitoringActiveSnapshot,
  monitoringPeriodicSnapshotForRequest,
  monitoringTemporalBasisLabel,
  monitoringTemporalGranularityLabel,
  monitoringTemporalLensRequestPath,
  monitoringTemporalLensUnavailableMessage,
  monitoringTemporalPeriodLabel,
  monitoringTemporalSnapshotCoherence,
  monitoringWorkItemsById,
  plannedComparisonLabel,
  plannedPeriodQuantityLabel,
  progressDetailPath,
  scheduleRealizationPresentation,
  recordedAtLabel,
  rowWeightPresentation,
  selectedWorkItem,
  temporalActualQuantityLabel,
  temporalLensItemsByBoqItemId,
  weightCompletenessLabel,
  type MonitoringItem,
  type MonitoringProgressComparisonPoint,
  type MonitoringResponse,
  type MonitoringTemporalLensItem,
  type MonitoringTemporalPeriod,
} from './monitoringCurrent.ts';

const item = (
  values: Partial<MonitoringItem> & Pick<MonitoringItem, 'id' | 'name'>,
): MonitoringItem => ({
  parentId: null,
  wbsNodeId: null,
  wbsCode: values.id,
  itemType: 'WORK_ITEM',
  sortOrder: 0,
  planned: { quantity: '10', unit: 'm3' },
  weight: {
    own: { state: 'AVAILABLE', percentage: '10', reason: null },
    subtree: { state: 'NOT_APPLICABLE', percentage: null, reason: null },
    cumulative: { state: 'AVAILABLE', percentage: '10', reason: null },
  },
  currentOfficialQuantity: {
    state: 'NOT_YET_RECORDED',
  },
  currentOfficialItemProgress: {
    state: 'NOT_YET_RECORDED',
  },
  actual: {
    state: 'NOT_YET_RECORDED',
    effectiveRecord: null,
  },
  ...values,
});

test('H2-A0-1 hierarchy stays depth-first and structural rows remain visible', () => {
  const rows = buildMonitoringRows([
    item({ id: 'child-2', name: 'Child 2', parentId: 'folder', sortOrder: 3 }),
    item({
      id: 'folder',
      name: 'Folder',
      itemType: 'FOLDER',
      sortOrder: 1,
      actual: null,
    }),
    item({ id: 'child-1', name: 'Child 1', parentId: 'folder', sortOrder: 2 }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.id, row.number, row.depth]),
    [
      ['folder', '1', 0],
      ['child-1', '1.1', 1],
      ['child-2', '1.2', 1],
    ],
  );
});

test('H2-A0-2 only a selected WORK_ITEM may drive contextual Actual', () => {
  const rows = buildMonitoringRows([
    item({ id: 'folder', name: 'Folder', itemType: 'FOLDER', actual: null }),
    item({ id: 'work', name: 'Work', parentId: 'folder', sortOrder: 1 }),
  ]);
  assert.equal(selectedWorkItem(rows, 'folder'), null);
  assert.equal(selectedWorkItem(rows, 'work')?.name, 'Work');
});

test('H2-A0-3 effectiveRecord is consumed and compatibility latestRecord is ignored', () => {
  const monitored = item({
    id: 'work',
    name: 'Work',
    actual: {
      state: 'RECORDED',
      lifecycleState: 'VERIFIED',
      effectiveRecord: {
        id: 'effective',
        installedQuantity: '2',
        workDate: '2026-05-20T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_MEASUREMENT',
        evidenceReferences: [],
        recordedByAccountId: 'actor',
        supersedesEntryId: 'original',
        recordedAt: '2026-05-22T00:00:00.000Z',
      },
      latestRecord: { id: 'compatibility', installedQuantity: '999' },
    },
  });

  assert.equal(effectiveActual(monitored)?.id, 'effective');
  assert.equal(effectiveActual(monitored)?.installedQuantity, '2');
});

test('H2-A0-4 numeric zero remains recorded and differs from no record', () => {
  const zero = item({
    id: 'zero',
    name: 'Zero',
    actual: {
      state: 'RECORDED',
      lifecycleState: 'SUBMITTED',
      effectiveRecord: {
        id: 'zero-entry',
        installedQuantity: '0',
        workDate: '2026-08-31T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_OBSERVATION',
        evidenceReferences: [],
        recordedByAccountId: null,
        supersedesEntryId: null,
        recordedAt: '2026-08-31T01:00:00.000Z',
      },
    },
  });
  const missing = item({ id: 'missing', name: 'Missing' });

  assert.equal(effectiveActual(zero)?.installedQuantity, '0');
  assert.equal(actualStateLabel(zero.actual), 'Diajukan');
  assert.equal(effectiveActual(missing), null);
  assert.equal(actualStateLabel(missing.actual), 'BELUM DICATAT');
  assert.equal(
    actualStateLabel({ state: 'UNAVAILABLE', effectiveRecord: null }),
    'TIDAK TERSEDIA',
  );
});

test('H2-A0-5 lifecycle governance states use bounded Indonesian labels', () => {
  assert.equal(lifecycleLabel('LEGACY_UNSPECIFIED'), 'Status lama');
  assert.equal(lifecycleLabel('RECORDED'), 'Tercatat');
  assert.equal(lifecycleLabel('SUBMITTED'), 'Diajukan');
  assert.equal(lifecycleLabel('VERIFIED'), 'Terverifikasi');
  assert.equal(lifecycleLabel('ACCEPTED'), 'Diterima');
  const unknown = lifecycleLabel('SOME_FUTURE_UNKNOWN_STATE');
  assert.equal(unknown, 'Status belum dikenali');
  assert.ok(
    ![
      'TIDAK TERSEDIA',
      'Tercatat',
      'Diajukan',
      'Terverifikasi',
      'Diterima',
    ].includes(unknown),
  );
});

test('H2-A0-5b capture methods distinguish unrecognized from unavailable', () => {
  const knownLabels = [
    'Observasi lapangan',
    'Pengukuran lapangan',
    'Referensi dokumen',
    'Metode tidak tersedia',
  ];
  assert.equal(captureMethodLabel('FIELD_OBSERVATION'), knownLabels[0]);
  assert.equal(captureMethodLabel('FIELD_MEASUREMENT'), knownLabels[1]);
  assert.equal(captureMethodLabel('DOCUMENT_REFERENCE'), knownLabels[2]);
  assert.equal(captureMethodLabel('LEGACY_UNSPECIFIED'), knownLabels[3]);
  const unknown = captureMethodLabel('SOME_FUTURE_CAPTURE_METHOD');
  assert.equal(unknown, 'Metode belum dikenali');
  assert.ok(!['TIDAK TERSEDIA', ...knownLabels].includes(unknown));
});

test('H2-A0-6 workDate and recordedAt keep different meanings and timezone bases', () => {
  assert.equal(
    dataThroughLabel({
      state: 'RECORDED',
      workDate: '2026-05-20T00:00:00.000Z',
    }),
    '20 Mei 2026',
  );
  const freshness = lastRecordedLabel(
    { state: 'RECORDED', recordedAt: '2026-05-22T00:00:00.000Z' },
    'Asia/Jayapura',
  );
  assert.match(freshness.value, /22 Mei 2026/);
  assert.match(freshness.value, /09\.00/);
  assert.equal(freshness.basis, 'Waktu proyek (Asia/Jayapura)');
  assert.notEqual(
    dataThroughLabel({
      state: 'RECORDED',
      workDate: '2026-05-20T00:00:00.000Z',
    }),
    freshness.value,
  );
  assert.match(
    recordedAtLabel('2026-05-22T00:00:00.000Z', 'Asia/Jayapura').value,
    /09\.00/,
  );
});

test('H2-A0-7 empty freshness is explicit and never becomes the current date or zero', () => {
  assert.equal(
    dataThroughLabel({ state: 'NOT_YET_RECORDED', workDate: null }),
    'BELUM DICATAT',
  );
  assert.deepEqual(
    lastRecordedLabel(
      { state: 'NOT_YET_RECORDED', recordedAt: null },
      'Asia/Makassar',
    ),
    { value: 'BELUM DICATAT', basis: '' },
  );
});

test('H2-A0-8 the healthy progress-detail door remains exact', () => {
  assert.equal(
    progressDetailPath('project-1', 'item-1'),
    '/field/project/project-1/progress/item-1',
  );
});

test('MON04 comparison cutoff uses only the canonical data-through business date', () => {
  assert.equal(
    monitoringComparisonCutoff({
      state: 'RECORDED',
      workDate: '2026-09-07T00:00:00.000Z',
    }),
    '2026-09-07',
  );
  assert.equal(
    monitoringComparisonCutoff({
      state: 'RECORDED',
      workDate: '2026-09-07',
    }),
    '2026-09-07',
  );
  assert.equal(
    monitoringComparisonCutoff({
      state: 'RECORDED',
      workDate: '2026-09-07T01:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    monitoringComparisonCutoff({
      state: 'NOT_YET_RECORDED',
      workDate: null,
    }),
    null,
  );
  assert.equal(
    monitoringComparisonCutoff({ state: 'UNAVAILABLE', workDate: null }),
    null,
  );

  const path = monitoringComparisonRequestPath('project-1', '2026-09-07');
  assert.equal(
    path,
    '/projects/project-1/progress/monitoring?cutoffDate=2026-09-07&includeProgressComparison=true',
  );
  const query = new URLSearchParams(path.split('?')[1]);
  assert.deepEqual([...query.entries()], [
    ['cutoffDate', '2026-09-07'],
    ['includeProgressComparison', 'true'],
  ]);
  assert.equal(query.has('includeActualSeries'), false);

  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');
  const cutoffBlock = utility.slice(
    utility.indexOf('export function monitoringComparisonCutoff'),
    utility.indexOf('export function monitoringComparisonRequestPath'),
  );
  assert.doesNotMatch(cutoffBlock, /Date\.now|new Date|toISOString/);
});

test('MON04 comparison labels preserve zero, uncertainty, and exact Decimal strings', () => {
  assert.equal(
    plannedComparisonLabel({
      state: 'COMPLETE',
      plannedRabWeightedPhysicalProgressPercent: '0',
    }),
    '0%',
  );
  assert.equal(
    actualComparisonLabel({
      state: 'COMPLETE',
      currentOfficialRabWeightedPhysicalProgressPercent: '0.000',
    }),
    '0.000%',
  );
  assert.equal(
    plannedComparisonLabel({
      state: 'INCOMPLETE',
      reason: 'PLANNED_CURVE_INCOMPLETE',
      knownWeightedPlannedProgressSubtotalPercent: '12.3400',
    }),
    'Belum lengkap · subtotal 12.3400%',
  );
  assert.equal(
    actualComparisonLabel({
      state: 'INCOMPLETE',
      knownWeightedContributionSubtotalPercent: '9.8700',
    }),
    'Belum lengkap · subtotal 9.8700%',
  );
  assert.equal(
    actualComparisonLabel({
      state: 'UNAVAILABLE',
      reason: 'BASELINE_VALUE_UNAVAILABLE',
    }),
    'Tidak tersedia',
  );

  assert.deepEqual(
    deviationComparisonPresentation({ state: 'COMPLETE', value: '-2.0000' }),
    {
      value: '-2.0000 pp',
      meaning: 'Tertinggal dari rencana',
    },
  );
  assert.deepEqual(
    deviationComparisonPresentation({ state: 'COMPLETE', value: '4.1250' }),
    {
      value: '4.1250 pp',
      meaning: 'Lebih maju dari rencana',
    },
  );
  assert.deepEqual(
    deviationComparisonPresentation({ state: 'COMPLETE', value: '0.0000' }),
    {
      value: '0.0000 pp',
      meaning: 'Sesuai rencana',
    },
  );
  assert.deepEqual(
    deviationComparisonPresentation({
      state: 'UNAVAILABLE',
      reason: {
        planned: null,
        actual: 'ACTUAL_INCOMPLETE',
      },
    }),
    {
      value: 'Tidak tersedia',
      meaning: 'Fakta realisasi belum lengkap.',
    },
  );
});

test('MON04 chart projects canonical dates without inventing or joining unknown points', () => {
  const points: MonitoringProgressComparisonPoint[] = [
    {
      cutoffDate: '2026-09-01',
      planned: {
        state: 'COMPLETE',
        plannedRabWeightedPhysicalProgressPercent: '0',
      },
      actual: {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: '0',
      },
      deviationPercentagePoints: { state: 'COMPLETE', value: '0' },
    },
    {
      cutoffDate: '2026-09-02',
      planned: {
        state: 'INCOMPLETE',
        reason: 'PLANNED_CURVE_INCOMPLETE',
        knownWeightedPlannedProgressSubtotalPercent: '4',
      },
      actual: {
        state: 'UNAVAILABLE',
        reason: 'BASELINE_VALUE_UNAVAILABLE',
      },
      deviationPercentagePoints: {
        state: 'UNAVAILABLE',
        reason: {
          planned: 'PLANNED_INCOMPLETE',
          actual: 'ACTUAL_UNAVAILABLE',
        },
      },
    },
    {
      cutoffDate: '2026-09-11',
      planned: {
        state: 'COMPLETE',
        plannedRabWeightedPhysicalProgressPercent: '26.1250',
      },
      actual: {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: '24.1250',
      },
      deviationPercentagePoints: { state: 'COMPLETE', value: '-2.0000' },
    },
  ];
  const chart = monitoringComparisonChartProjection(points);

  assert.deepEqual(
    chart.points.map((point) => point.cutoffDate),
    points.map((point) => point.cutoffDate),
  );
  assert.equal(chart.points[0].plannedY, chart.height - chart.padding);
  assert.equal(chart.points[0].actualY, chart.height - chart.padding);
  assert.equal(chart.points[1].plannedY, null);
  assert.equal(chart.points[1].actualY, null);
  assert.equal(chart.plannedSegments.length, 0);
  assert.equal(chart.actualSegments.length, 0);

  const completePoints = points.map((point) => ({
    ...point,
    planned: {
      state: 'COMPLETE' as const,
      plannedRabWeightedPhysicalProgressPercent: '10',
    },
    actual: {
      state: 'COMPLETE' as const,
      currentOfficialRabWeightedPhysicalProgressPercent: '10',
    },
    deviationPercentagePoints: {
      state: 'COMPLETE' as const,
      value: '0',
    },
  }));
  const irregular = monitoringComparisonChartProjection(completePoints);
  const firstX = irregular.points[0].x;
  const secondX = irregular.points[1].x;
  const thirdX = irregular.points[2].x;
  assert.notEqual(firstX, null);
  assert.notEqual(secondX, null);
  assert.notEqual(thirdX, null);
  assert.ok(
    secondX! - firstX! < thirdX! - secondX!,
    'one day must occupy less x-distance than nine days',
  );

  const single = monitoringComparisonChartProjection([points[0]]);
  assert.equal(single.points[0].x, single.width / 2);
  assert.equal(single.plannedSegments.length, 0);
  assert.equal(single.actualSegments.length, 0);

  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');
  const chartBlock = utility.slice(
    utility.indexOf('export function monitoringComparisonChartProjection'),
    utility.indexOf('export function lastRecordedLabel'),
  );
  assert.doesNotMatch(chartBlock, /\.sort\(|new Set|interpolat/i);
});

test('MON04 chart holds the previous value until the next canonical boundary', () => {
  const points: MonitoringProgressComparisonPoint[] = [
    {
      cutoffDate: '2026-09-01',
      planned: {
        state: 'COMPLETE',
        plannedRabWeightedPhysicalProgressPercent: '10',
      },
      actual: {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: '5',
      },
      deviationPercentagePoints: { state: 'COMPLETE', value: '-5' },
    },
    {
      cutoffDate: '2026-09-10',
      planned: {
        state: 'COMPLETE',
        plannedRabWeightedPhysicalProgressPercent: '30',
      },
      actual: {
        state: 'COMPLETE',
        currentOfficialRabWeightedPhysicalProgressPercent: '25',
      },
      deviationPercentagePoints: { state: 'COMPLETE', value: '-5' },
    },
  ];
  const chart = monitoringComparisonChartProjection(points);
  const [first, second] = chart.points;

  assert.deepEqual(
    chart.points.map((point) => point.cutoffDate),
    points.map((point) => point.cutoffDate),
  );
  assert.deepEqual(chart.plannedSegments, [
    {
      from: { x: first.x, y: first.plannedY },
      to: { x: second.x, y: first.plannedY },
    },
    {
      from: { x: second.x, y: first.plannedY },
      to: { x: second.x, y: second.plannedY },
    },
  ]);
  assert.deepEqual(chart.actualSegments, [
    {
      from: { x: first.x, y: first.actualY },
      to: { x: second.x, y: first.actualY },
    },
    {
      from: { x: second.x, y: first.actualY },
      to: { x: second.x, y: second.actualY },
    },
  ]);
  for (const [segments, previousY, currentY] of [
    [chart.plannedSegments, first.plannedY, second.plannedY],
    [chart.actualSegments, first.actualY, second.actualY],
  ] as const) {
    assert.equal(
      segments.some(
        (segment) =>
          segment.from.x === first.x &&
          segment.from.y === previousY &&
          segment.to.x === second.x &&
          segment.to.y === currentY,
      ),
      false,
    );
  }

  const equal = monitoringComparisonChartProjection([
    points[0],
    {
      ...points[1],
      planned: points[0].planned,
      actual: points[0].actual,
      deviationPercentagePoints: { state: 'COMPLETE', value: '-5' },
    },
  ]);
  assert.deepEqual(equal.plannedSegments, [
    {
      from: { x: equal.points[0].x, y: equal.points[0].plannedY },
      to: { x: equal.points[1].x, y: equal.points[0].plannedY },
    },
  ]);
  assert.deepEqual(equal.actualSegments, [
    {
      from: { x: equal.points[0].x, y: equal.points[0].actualY },
      to: { x: equal.points[1].x, y: equal.points[0].actualY },
    },
  ]);
});

test('H2-A0-9 the shell states project scope, Terkini, and both freshness meanings', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, /SELURUH PROYEK/);
  assert.match(page, />\s*TERKINI\s*</);
  assert.match(page, /Data pekerjaan sampai/);
  assert.match(page, /Terakhir diperbarui/);
  assert.match(page, /effectiveActual\(row\)/);
  assert.doesNotMatch(page, /actual\.latestRecord/);
});

test('H2-A0-10 the product surface uses human language without exposing internal identity', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, />Monitoring Proyek</);
  assert.match(page, /item pekerjaan/);
  assert.match(page, /Pekerjaan · \{selected\.number\}/);
  assert.match(page, /<dt>Status Realisasi<\/dt>/);
  assert.match(page, /<dt>Tanggal Pekerjaan<\/dt>/);
  assert.match(page, /<dt>Dicatat di SIMPROK<\/dt>/);
  assert.doesNotMatch(page, />[^<{]*WORK_ITEM[^<{]*</);
  assert.doesNotMatch(page, /\(workDate\)|\(recordedAt\)/);
  assert.doesNotMatch(page, /\{project\.code\}\s*·\s*\{project\.id\}/);
  assert.doesNotMatch(
    page,
    /<code>\{monitoring\.baseline\.id\}<\/code>/,
  );
  assert.equal((page.match(/<dt>Status Realisasi<\/dt>/g) ?? []).length, 1);
  assert.doesNotMatch(page, /<dt>Lifecycle<\/dt>/);
});

test('H2-A0-11 the shell neither consumes legacy reality nor paints later truth', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.doesNotMatch(page, /\/reality|ProjectWarRoomPage|DeviationService/);
  assert.doesNotMatch(
    page,
    /Kurva S Realisasi|planned-to-date|Forecast|Recovery|CPM/,
  );
  assert.match(page, /ExecutionPlanReadinessPanel/);
  assert.doesNotMatch(page, />\s*Network\s*</);
  assert.match(page, /Realisasi Terakhir yang Berlaku/);
  assert.match(
    page,
    /Realisasi Terakhir yang Berlaku adalah catatan aktual[\s\S]*?perhitungan dan Progress fisik resmi/,
  );
  assert.match(page, /Progress fisik resmi RAB/);
  assert.match(page, /Progress fisik resmi/);
  assert.match(page, /Catat \/ Kelola Actual/);
  assert.match(page, /Lihat Riwayat Actual/);
  assert.match(page, /hasPermission\('FIELD_PROGRESS_SUBMIT'\)/);
});

test('MON03 read authority keeps history while submit authority gates the write form', () => {
  const page = readFileSync('src/pages/field/SubmitProgressPage.tsx', 'utf8');
  assert.match(page, /const \{ token, hasPermission \} = useAuth\(\)/);
  assert.match(page, /hasPermission\("FIELD_PROGRESS_SUBMIT"\)/);
  assert.match(page, /<h3>Riwayat Actual<\/h3>/);
  assert.match(page, /\{canSubmitActual && \(\s*<form onSubmit=\{submit\}/);
  assert.match(page, /\? "Catat Actual Lapangan"\s*: "Riwayat Actual Lapangan"/);
  assert.match(page, />\s*Simpan Actual\s*<\/button>/);
});

test('MON04 verifier UI shows every current root and requires an explicit human confirmation', () => {
  const page = readFileSync('src/pages/field/SubmitProgressPage.tsx', 'utf8');
  assert.match(page, /semanticVerification\.currentLeaves\.map/);
  assert.match(page, /Pastikan Actual tidak tumpang tindih/);
  assert.match(page, /Tinjau dan konfirmasi/);
  assert.match(page, /type="checkbox"/);
  assert.match(
    page,
    /memastikan Actual target adalah tambahan fisik[\s\S]*bukan duplikasi atau tumpang tindih/,
  );
  assert.match(page, /semantic-attestations/);
  assert.match(page, /contextDigest: semanticVerification\.contextDigest/);
  assert.match(page, /confirmed: true/);
});

test('H2-A1-1 item and cumulative weights use backend facts with display rounding last', () => {
  const monitored = item({
    id: 'weighted',
    name: 'Weighted',
    weight: {
      own: {
        state: 'AVAILABLE',
        percentage: '33.333333333333333333',
        reason: null,
      },
      subtree: { state: 'NOT_APPLICABLE', percentage: null, reason: null },
      cumulative: {
        state: 'AVAILABLE',
        percentage: '66.666666666666666667',
        reason: null,
      },
    },
  });

  assert.equal(rowWeightPresentation(monitored).value, '33,33%');
  assert.equal(
    formatWeightPercentage(monitored.weight.cumulative),
    '66,67%',
  );
});

test('H2-A1-2 structural aggregate is labeled as a section, never an owned item weight', () => {
  const structural = item({
    id: 'folder',
    name: 'Folder',
    itemType: 'FOLDER',
    actual: null,
    weight: {
      own: { state: 'NOT_APPLICABLE', percentage: null, reason: null },
      subtree: { state: 'AVAILABLE', percentage: '50', reason: null },
      cumulative: { state: 'AVAILABLE', percentage: '50', reason: null },
    },
  });

  assert.deepEqual(rowWeightPresentation(structural), {
    kind: 'SECTION',
    value: '50,00%',
  });
  assert.equal(formatWeightPercentage(structural.weight.own), '—');
});

test('H2-A1-3 unavailable weight never becomes zero while authoritative zero remains visible', () => {
  assert.equal(
    formatWeightPercentage({
      state: 'UNAVAILABLE',
      percentage: null,
      reason: 'ITEM_VALUE_UNAVAILABLE',
    }),
    'TIDAK TERSEDIA',
  );
  assert.equal(
    formatWeightPercentage({
      state: 'AVAILABLE',
      percentage: '0',
      reason: null,
    }),
    '0,00%',
  );
});

test('H2-A1-4 coverage language is bounded and never presented as project progress', () => {
  assert.equal(
    weightCompletenessLabel({
      basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST',
      completeness: 'COMPLETE',
      reason: null,
      denominator: { state: 'AVAILABLE', value: '1000.00' },
      eligibleWorkItemCount: 3,
      weightedWorkItemCount: 3,
      unavailableWorkItemCount: 0,
    }),
    'Lengkap',
  );
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, /Bobot terhadap proyek/);
  assert.match(page, /Bobot kumulatif RAB/);
  assert.match(page, /bukan persentase kemajuan/);
  assert.doesNotMatch(page, /planned-to-date|ahead|behind|On Track/);
});

/* SCHEDULE_REALIZATION_PRESENTATION_V1 */

test('SCHEDULE-REALIZATION-1 lookup uses exact BoqItem identity and never WBS/name fallback', () => {
  const workA = item({ id: 'boq-a', name: 'Same Name' });
  const workB = item({ id: 'boq-b', name: 'Same Name' });
  const folder = item({
    id: 'folder-a',
    name: 'Same Name',
    itemType: 'FOLDER',
    actual: null,
  });
  const lookup = monitoringWorkItemsById([workB, folder, workA]);

  assert.equal(lookup.get('boq-a'), workA);
  assert.equal(lookup.get('boq-b'), workB);
  assert.equal(lookup.has('folder-a'), false);
  assert.equal(lookup.get('missing'), undefined);
});

test('SCHEDULE-REALIZATION-2 COMPLETE facts preserve exact backend strings and effective work date', () => {
  const monitored = item({
    id: 'complete',
    name: 'Complete',
    currentOfficialQuantity: {
      state: 'COMPLETE',
      currentOfficialQuantity: '12.5',
    },
    currentOfficialItemProgress: {
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '125',
      boundedContributionProgressPercent: '24.000000000000000000',
    },
    actual: {
      state: 'RECORDED',
      lifecycleState: 'VERIFIED',
      effectiveRecord: {
        id: 'effective-complete',
        installedQuantity: '999',
        workDate: '2026-09-07T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_MEASUREMENT',
        evidenceReferences: [],
        recordedByAccountId: null,
        supersedesEntryId: null,
        recordedAt: '2026-09-08T01:00:00.000Z',
      },
    },
  });

  assert.deepEqual(scheduleRealizationPresentation(monitored, 'm3'), {
    currentOfficialQuantity: '12.5 m3',
    currentOfficialItemProgress: '24.000000000000000000%',
    effectiveWorkDate: '7 Sep 2026',
    quantityState: 'Lengkap',
    progressState: 'Lengkap',
  });
});

test('SCHEDULE-REALIZATION-3 lawful COMPLETE zero remains zero', () => {
  const monitored = item({
    id: 'zero',
    name: 'Zero',
    currentOfficialQuantity: {
      state: 'COMPLETE',
      currentOfficialQuantity: '0',
    },
    currentOfficialItemProgress: {
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '0',
      boundedContributionProgressPercent: '0',
    },
  });
  const view = scheduleRealizationPresentation(monitored, 'm3');

  assert.equal(view.currentOfficialQuantity, '0 m3');
  assert.equal(view.currentOfficialItemProgress, '0%');
  assert.equal(view.quantityState, 'Lengkap');
  assert.notEqual(view.currentOfficialQuantity, 'BELUM DICATAT');
});

test('SCHEDULE-REALIZATION-4 NOT_YET_RECORDED never becomes zero', () => {
  const view = scheduleRealizationPresentation(
    item({ id: 'missing', name: 'Missing' }),
    'm3',
  );

  assert.equal(view.currentOfficialQuantity, 'BELUM DICATAT');
  assert.equal(view.currentOfficialItemProgress, 'BELUM DICATAT');
  assert.equal(view.effectiveWorkDate, 'BELUM DICATAT');
  assert.equal(view.quantityState, 'Belum dicatat');
  assert.equal(view.progressState, 'Belum dicatat');
  assert.doesNotMatch(JSON.stringify(view), /(^|[^0-9])0([^0-9]|$)/);
});

test('SCHEDULE-REALIZATION-5 INCOMPLETE exposes known subtotals without claiming complete', () => {
  const view = scheduleRealizationPresentation(
    item({
      id: 'incomplete',
      name: 'Incomplete',
      currentOfficialQuantity: {
        state: 'INCOMPLETE',
        knownEligibleQuantitySubtotal: '4.25',
      },
      currentOfficialItemProgress: {
        state: 'INCOMPLETE',
        knownProgressSubtotalPercent: '17.5',
      },
    }),
    'm3',
  );

  assert.equal(view.currentOfficialQuantity, 'Belum lengkap — subtotal 4.25 m3');
  assert.equal(view.currentOfficialItemProgress, 'BELUM LENGKAP — subtotal 17.5%');
  assert.equal(view.quantityState, 'Belum lengkap');
  assert.equal(view.progressState, 'Belum lengkap');
});

test('SCHEDULE-REALIZATION-6 unavailable and invalid facts remain explicit', () => {
  const unavailable = scheduleRealizationPresentation(
    item({
      id: 'unavailable',
      name: 'Unavailable',
      currentOfficialQuantity: { state: 'SEMANTICS_UNPROVEN' },
      currentOfficialItemProgress: {
        state: 'UNAVAILABLE',
        reason: 'PLANNED_QUANTITY_ZERO',
      },
      actual: { state: 'UNAVAILABLE', effectiveRecord: null },
    }),
    'm3',
  );
  assert.deepEqual(unavailable, {
    currentOfficialQuantity: 'SEMANTIK BELUM TERBUKTI',
    currentOfficialItemProgress: 'TIDAK TERSEDIA — PLANNED_QUANTITY_ZERO',
    effectiveWorkDate: 'TIDAK TERSEDIA',
    quantityState: 'Semantik belum terbukti',
    progressState: 'Tidak tersedia',
  });

  const invalid = scheduleRealizationPresentation(
    item({
      id: 'invalid',
      name: 'Invalid',
      currentOfficialQuantity: { state: 'INVALID_NUMERIC_FACT' },
      currentOfficialItemProgress: { state: 'INVALID_LINEAGE' },
    }),
    'm3',
  );
  assert.equal(invalid.currentOfficialQuantity, 'FAKTA NUMERIK TIDAK VALID');
  assert.equal(invalid.currentOfficialItemProgress, 'LINEAGE TIDAK VALID');
  assert.equal(invalid.quantityState, 'Fakta numerik tidak valid');
  assert.equal(invalid.progressState, 'Lineage tidak valid');

  assert.deepEqual(scheduleRealizationPresentation(undefined, 'm3'), {
    currentOfficialQuantity: 'TIDAK TERSEDIA',
    currentOfficialItemProgress: 'TIDAK TERSEDIA',
    effectiveWorkDate: 'TIDAK TERSEDIA',
    quantityState: 'Tidak tersedia',
    progressState: 'Tidak tersedia',
  });
});
/* OFFICIAL_TRUTH_CONTRACT_GUARDS_V1 */

test('OFFICIAL-1 official quantity COMPLETE preserves exact zero', () => {
  const monitored = item({
    id: 'official-zero',
    name: 'Official Zero',
    currentOfficialQuantity: {
      state: 'COMPLETE',
      currentOfficialQuantity: '0',
    },
  });

  assert.equal(
    monitored.currentOfficialQuantity.state,
    'COMPLETE',
  );

  assert.equal(
    monitored.currentOfficialQuantity.currentOfficialQuantity,
    '0',
  );
});

test('OFFICIAL-2 INCOMPLETE remains distinct from unavailable and zero', () => {
  const monitored = item({
    id: 'official-incomplete',
    name: 'Official Incomplete',
    currentOfficialQuantity: {
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: '12.500000',
    },
  });

  assert.equal(
    monitored.currentOfficialQuantity.state,
    'INCOMPLETE',
  );

  assert.equal(
    monitored.currentOfficialQuantity.knownEligibleQuantitySubtotal,
    '12.500000',
  );
});

test('OFFICIAL-3 Law-1 no eligible fact remains explicit', () => {
  const monitored = item({
    id: 'official-no-fact',
    name: 'Official No Fact',
    currentOfficialQuantity: {
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    },
  });

  assert.equal(
    monitored.currentOfficialQuantity.state,
    'NO_ELIGIBLE_CURRENT_FACT',
  );

  assert.notEqual(
    monitored.currentOfficialQuantity.state,
    'NOT_YET_RECORDED',
  );
});

test('OFFICIAL-4 invalid lineage remains fail-closed', () => {
  const monitored = item({
    id: 'official-invalid-lineage',
    name: 'Official Invalid Lineage',
    currentOfficialQuantity: {
      state: 'INVALID_LINEAGE',
    },
  });

  assert.equal(
    monitored.currentOfficialQuantity.state,
    'INVALID_LINEAGE',
  );
});

test('OFFICIAL-5 official item progress consumes backend result without recalculation', () => {
  const monitored = item({
    id: 'official-progress',
    name: 'Official Progress',
    currentOfficialItemProgress: {
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '37.500000',
      boundedContributionProgressPercent: '37.500000',
    },
  });

  assert.equal(
    monitored.currentOfficialItemProgress.state,
    'COMPLETE',
  );

  assert.equal(
    monitored.currentOfficialItemProgress.boundedContributionProgressPercent,
    '37.500000',
  );
});

test('OFFICIAL-6 official item progress preserves UNAVAILABLE reason', () => {
  const monitored = item({
    id: 'official-unavailable',
    name: 'Official Unavailable',
    currentOfficialItemProgress: {
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_ZERO',
    },
  });

  assert.equal(
    monitored.currentOfficialItemProgress.state,
    'UNAVAILABLE',
  );

  assert.equal(
    monitored.currentOfficialItemProgress.reason,
    'PLANNED_QUANTITY_ZERO',
  );
});

test('OFFICIAL-7 record context and official calculation truth remain separate', () => {
  const monitored = item({
    id: 'official-separation',
    name: 'Official Separation',
    actual: {
      state: 'RECORDED',
      lifecycleState: 'VERIFIED',
      effectiveRecord: {
        id: 'record-1',
        installedQuantity: '5',
        workDate: '2026-08-31T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_MEASUREMENT',
        evidenceReferences: [],
        recordedByAccountId: null,
        supersedesEntryId: null,
        recordedAt: '2026-08-31T01:00:00.000Z',
      },
    },
    currentOfficialQuantity: {
      state: 'COMPLETE',
      currentOfficialQuantity: '7',
    },
  });

  assert.equal(
    effectiveActual(monitored)?.installedQuantity,
    '5',
  );

  assert.equal(
    monitored.currentOfficialQuantity.state,
    'COMPLETE',
  );

  assert.equal(
    monitored.currentOfficialQuantity.currentOfficialQuantity,
    '7',
  );
});

test('OFFICIAL-8 page consumes official truth while retaining effective record context', () => {
  const page = readFileSync(
    'src/pages/field/ProjectWorkPage.tsx',
    'utf8',
  );

  assert.match(page, /officialQuantityLabel\(/);
  assert.match(page, /officialItemProgressLabel\(/);
  assert.match(page, /officialProjectProgressLabel\(/);
  assert.match(page, /effectiveActual\(row\)/);
  assert.match(page, /effectiveActual\(selected\)/);

  assert.doesNotMatch(
    page,
    /actual\.latestRecord/,
  );
});

test('OFFICIAL-9 page does not introduce frontend progress arithmetic', () => {
  const page = readFileSync(
    'src/pages/field/ProjectWorkPage.tsx',
    'utf8',
  );

  assert.doesNotMatch(
    page,
    /currentOfficialQuantity[^;\n]*(\/|\*|\+|-)/,
  );

  assert.doesNotMatch(
    page,
    /currentOfficial.*planned\.quantity/,
  );

  assert.doesNotMatch(
    page,
    /parseFloat|parseInt|Number\([^)]*currentOfficial|Math\./,
  );
});

const snapshotBaselineA = {
  id: 'baseline-a', versionNumber: 1, approvedAt: '2026-08-01T00:00:00.000Z',
};
const snapshotBaselineB = {
  id: 'baseline-b', versionNumber: 2, approvedAt: '2026-09-01T00:00:00.000Z',
};

function snapshotTemporalItem(boqItemId: string): MonitoringTemporalLensItem {
  return {
    boqItemId,
    planned: {
      periodQuantity: { state: 'COMPLETE', plannedQuantity: '4' },
      cumulativeQuantityThroughEndDate: { state: 'COMPLETE', plannedQuantity: '7' },
    },
    actual: {
      periodOfficialQuantity: { state: 'COMPLETE', currentOfficialQuantity: '3' },
      cumulativeOfficialQuantityThroughEndDate: {
        state: 'COMPLETE', currentOfficialQuantity: '5',
      },
    },
  };
}

function monitoringSnapshot(input: {
  projectId?: string;
  baseline: MonitoringResponse['baseline'];
  lensBaseline?: MonitoringResponse['baseline'];
  items: MonitoringItem[];
  temporalItems?: MonitoringTemporalLensItem[];
  includeLens?: boolean;
}): MonitoringResponse {
  const temporalItems = input.temporalItems ?? input.items
    .filter((candidate) => candidate.itemType === 'WORK_ITEM')
    .map((candidate) => snapshotTemporalItem(candidate.id));
  const lensBaseline = input.lensBaseline === undefined
    ? input.baseline
    : input.lensBaseline;
  return {
    projectId: input.projectId ?? 'project-1',
    projectTimeZone: 'Asia/Jakarta',
    baseline: input.baseline,
    freshness: {
      dataThrough: { state: 'RECORDED', workDate: '2026-09-14' },
      lastRecordedAt: { state: 'RECORDED', recordedAt: '2026-09-14T08:00:00.000Z' },
    },
    weight: {
      basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST', completeness: 'COMPLETE', reason: null,
      denominator: { state: 'AVAILABLE', value: '100' },
      eligibleWorkItemCount: input.items.length, weightedWorkItemCount: input.items.length,
      unavailableWorkItemCount: 0,
    },
    currentOfficialRabWeightedPhysicalProgress: {
      state: 'COMPLETE', currentOfficialRabWeightedPhysicalProgressPercent: '10',
    },
    temporalLens: input.includeLens === false ? undefined : {
      mode: 'CANONICAL_MONITORING_TEMPORAL_LENS_V1', state: 'RESOLVED',
      basis: 'CALENDAR', granularity: 'WEEK', referenceDate: '2026-09-14',
      period: {
        basis: 'CALENDAR', granularity: 'WEEK', periodKey: '2026-W38', periodIndex: 38,
        startDate: '2026-09-14', endDate: '2026-09-20',
        metadata: {
          boundaryInclusivity: 'START_AND_END_INCLUSIVE',
          boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY', isoWeekYear: 2026, isoWeekNumber: 38,
        },
      },
      baseline: lensBaseline,
      plannedSource: null,
      plannedContext: { state: 'UNAVAILABLE', reason: 'NO_LOCKED_PLAN' },
      actualTruthMode: 'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_EXPLICIT_WORKDATE_WINDOW',
      items: temporalItems,
    },
    items: input.items,
    unavailable: [],
  };
}

test('TC-SNAPSHOT-1 Current A to Periodic B uses B Baseline', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA, items: [item({ id: 'item-A', name: 'A' })], includeLens: false,
  });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
  });
  const coherence = monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: periodicB,
  });
  assert.equal(coherence.state, 'COHERENT');
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentA, periodicResponse: periodicB,
  });
  assert.equal(active?.baseline?.id, 'baseline-b');
  assert.notEqual(active?.baseline?.id, currentA.baseline?.id);
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, /response: data, lens: coherence\.lens/);
  assert.match(page, /activeMonitoringSnapshot\.baseline\.versionNumber/);
});

test('TC-SNAPSHOT-2 Current A to Periodic B uses B RAB rows only', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA, items: [item({ id: 'item-A-1', name: 'A1' }),
      item({ id: 'item-A-2', name: 'A2' })], includeLens: false,
  });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B-1', name: 'B1' }),
      item({ id: 'item-B-2', name: 'B2' })],
  });
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentA, periodicResponse: periodicB,
  });
  assert.deepEqual(buildMonitoringRows(active?.items ?? []).map((row) => row.id),
    ['item-B-1', 'item-B-2']);
  assert.match(readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8'),
    /buildMonitoringRows\(activeMonitoringSnapshot\?\.items \?\? \[\]\)/);
});

test('TC-SNAPSHOT-3 same canonical item id uses B row facts', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA,
    items: [item({ id: 'work-1', name: 'Work', planned: { quantity: '10', unit: 'm3' } })],
    includeLens: false,
  });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB,
    items: [item({ id: 'work-1', name: 'Work', planned: { quantity: '12', unit: 'm3' } })],
  });
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentA, periodicResponse: periodicB,
  });
  const selected = selectedWorkItem(buildMonitoringRows(active?.items ?? []), 'work-1');
  assert.deepEqual(selected?.planned, { quantity: '12', unit: 'm3' });
});

test('TC-SNAPSHOT-4 Current A to Periodic null does not borrow A rows', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA, items: [item({ id: 'item-A', name: 'A' })], includeLens: false,
  });
  const periodicNull = monitoringSnapshot({ baseline: null, items: [] });
  assert.equal(monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: periodicNull,
  }).state, 'COHERENT');
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentA, periodicResponse: periodicNull,
  });
  assert.equal(active?.baseline, null);
  assert.deepEqual(buildMonitoringRows(active?.items ?? []), []);
});

test('TC-SNAPSHOT-5 Current null to Periodic B lawfully shows B', () => {
  const currentNull = monitoringSnapshot({ baseline: null, items: [], includeLens: false });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
  });
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentNull, periodicResponse: periodicB,
  });
  assert.equal(active?.baseline?.id, 'baseline-b');
  assert.equal(buildMonitoringRows(active?.items ?? [])[0]?.id, 'item-B');
});

test('TC-SNAPSHOT-6 selected A item missing in B becomes unselected', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA, items: [item({ id: 'item-A', name: 'A' })], includeLens: false,
  });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
  });
  const active = monitoringActiveSnapshot({
    mode: 'PERIODIK', currentResponse: currentA, periodicResponse: periodicB,
  });
  assert.equal(selectedWorkItem(buildMonitoringRows(active?.items ?? []), 'item-A'), null);
});

test('TC-SNAPSHOT-7 top-level Baseline B and lens Baseline C fail closed', () => {
  const incoherent = monitoringSnapshot({
    baseline: snapshotBaselineB,
    lensBaseline: { id: 'baseline-c', versionNumber: 3,
      approvedAt: '2026-09-02T00:00:00.000Z' },
    items: [item({ id: 'item-B', name: 'B' })],
  });
  assert.deepEqual(monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: incoherent,
  }), { state: 'INCOHERENT', reason: 'BASELINE_MISMATCH' });
  assert.match(readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8'),
    /Fakta periode tidak dapat ditampilkan karena konteks RAB dan periode/);
});

test('TC-SNAPSHOT-8 Temporal Lens item absent from same RAB fails closed', () => {
  const incoherent = monitoringSnapshot({
    baseline: snapshotBaselineB,
    items: [item({ id: 'item-B-1', name: 'B1' })],
    temporalItems: [snapshotTemporalItem('item-B-1'), snapshotTemporalItem('item-B-999')],
  });
  assert.deepEqual(monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: incoherent,
  }), { state: 'INCOHERENT', reason: 'TEMPORAL_ITEM_NOT_IN_SNAPSHOT' });
});

test('TC-SNAPSHOT-9 duplicate canonical identities fail closed', () => {
  const duplicateWorkItem = monitoringSnapshot({
    baseline: snapshotBaselineB,
    items: [item({ id: 'item-B', name: 'B1' }), item({ id: 'item-B', name: 'B2' })],
    temporalItems: [snapshotTemporalItem('item-B')],
  });
  assert.deepEqual(monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: duplicateWorkItem,
  }), { state: 'INCOHERENT', reason: 'DUPLICATE_WORK_ITEM_ID' });

  const duplicateTemporalItem = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
    temporalItems: [snapshotTemporalItem('item-B'), snapshotTemporalItem('item-B')],
  });
  assert.deepEqual(monitoringTemporalSnapshotCoherence({
    requestedProjectId: 'project-1', response: duplicateTemporalItem,
  }), { state: 'INCOHERENT', reason: 'DUPLICATE_TEMPORAL_ITEM_ID' });
});

test('TC-SNAPSHOT-10 stale Periodic full response cannot replace active request', () => {
  const responseB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
  });
  assert.equal(monitoringPeriodicSnapshotForRequest({
    activeRequestKey: 'request-C', responseRequestKey: 'request-B', response: responseB,
  }), null);
  assert.equal(monitoringPeriodicSnapshotForRequest({
    activeRequestKey: 'request-B', responseRequestKey: 'request-B', response: responseB,
  }), responseB);
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.ok(page.indexOf('temporalRequestGenerationRef.current !== generation') <
    page.indexOf('response: data, lens: coherence.lens'));
});

test('TC-SNAPSHOT-11 returning to TERKINI still uses Current A', () => {
  const currentA = monitoringSnapshot({
    baseline: snapshotBaselineA, items: [item({ id: 'item-A', name: 'A' })], includeLens: false,
  });
  const periodicB = monitoringSnapshot({
    baseline: snapshotBaselineB, items: [item({ id: 'item-B', name: 'B' })],
  });
  const active = monitoringActiveSnapshot({
    mode: 'TERKINI', currentResponse: currentA, periodicResponse: periodicB,
  });
  assert.equal(active, currentA);
  assert.equal(selectedWorkItem(buildMonitoringRows(active?.items ?? []), 'item-A')?.id, 'item-A');
});

test('TC-SNAPSHOT-12 repair adds no frontend business math', () => {
  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');
  const start = utility.indexOf('export type MonitoringTemporalSnapshotCoherence');
  const end = utility.indexOf('export interface MonitoringProject {', start);
  const repairHelpers = utility.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(repairHelpers,
    /Date\.now|new Date\(|getDay|getUTCDay|getMonth|getUTCMonth|parseFloat\(|Number\(|Math\./);
  assert.doesNotMatch(repairHelpers,
    /periodQuantity\s*[/*+-]|plannedQuantity\s*[/*+-]|currentOfficialQuantity\s*[/*+-]/);
});

test('MON04-TC-1 Temporal Lens request carries exactly one canonical context', () => {
  const url = new URL(monitoringTemporalLensRequestPath({
    projectId: 'project-1', basis: 'WORK_PERIOD', granularity: 'MONTH',
    referenceDate: '2026-07-20',
  }), 'https://simprok.test');
  assert.equal(url.pathname, '/projects/project-1/progress/monitoring');
  assert.deepEqual([...url.searchParams.entries()], [
    ['includeTemporalLens', 'true'], ['temporalBasis', 'WORK_PERIOD'],
    ['temporalGranularity', 'MONTH'], ['temporalReferenceDate', '2026-07-20'],
  ]);
  for (const forbidden of ['cutoffDate', 'includeProgressComparison',
    'includeActualSeries', 'includePeriodWindow', 'periodStartDate', 'periodEndDate']) {
    assert.equal(url.searchParams.has(forbidden), false);
  }
});

test('MON04-TC-2 period labels consume backend identity and ordinal only', () => {
  const base = { periodIndex: 3, startDate: '2026-06-01', endDate: '2026-06-07' };
  const workWeek: MonitoringTemporalPeriod = {
    ...base, basis: 'WORK_PERIOD', granularity: 'WEEK', periodKey: 'WORK-WEEK-3',
    metadata: { boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'SEVEN_DAY_WINDOW_FROM_GOVERNED_WORK_PERIOD_ANCHOR',
      governedWorkPeriodAnchorDate: '2026-05-18' },
  };
  const workMonth: MonitoringTemporalPeriod = {
    ...base, periodIndex: 2, basis: 'WORK_PERIOD', granularity: 'MONTH',
    periodKey: 'WORK-MONTH-2',
    metadata: { boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'ORIGINAL_ANCHOR_ANNIVERSARY_MONTH_WITH_TARGET_CLAMP',
      governedWorkPeriodAnchorDate: '2026-05-18' },
  };
  const calendarWeek: MonitoringTemporalPeriod = {
    ...base, periodIndex: 36, basis: 'CALENDAR', granularity: 'WEEK',
    periodKey: '2026-W36',
    metadata: { boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY', isoWeekYear: 2026, isoWeekNumber: 36 },
  };
  const calendarMonth: MonitoringTemporalPeriod = {
    ...base, periodIndex: 24320, basis: 'CALENDAR', granularity: 'MONTH',
    periodKey: '2026-08',
    metadata: { boundaryInclusivity: 'START_AND_END_INCLUSIVE',
      boundaryRule: 'GREGORIAN_CALENDAR_MONTH', calendarYear: 2026, calendarMonth: 8 },
  };
  assert.equal(monitoringTemporalPeriodLabel(workWeek), 'Minggu Kerja ke-3');
  assert.equal(monitoringTemporalPeriodLabel(workMonth), 'Bulan Kerja ke-2');
  assert.equal(monitoringTemporalPeriodLabel(calendarWeek), 'Minggu Kalender \u00b7 2026-W36');
  assert.equal(monitoringTemporalPeriodLabel(calendarMonth), 'Agustus 2026');
  assert.equal(monitoringTemporalBasisLabel('WORK_PERIOD'), 'Waktu Kerja');
  assert.equal(monitoringTemporalBasisLabel('CALENDAR'), 'Kalender');
  assert.equal(monitoringTemporalGranularityLabel('WEEK'), 'Mingguan');
  assert.equal(monitoringTemporalGranularityLabel('MONTH'), 'Bulanan');
});

test('MON04-TC-3 unavailable reasons are bounded human messages', () => {
  assert.match(monitoringTemporalLensUnavailableMessage(
    'GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED'), /Hari Pertama Resmi proyek belum dibuktikan/);
  assert.match(monitoringTemporalLensUnavailableMessage(
    'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID'), /bukti Hari Pertama Resmi tidak valid/);
  assert.match(monitoringTemporalLensUnavailableMessage(
    'REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR'), /sebelum Hari Pertama Resmi proyek/);
  assert.equal(monitoringTemporalLensUnavailableMessage('FUTURE_REASON'),
    'Konteks periode belum tersedia dari fakta proyek yang sah.');
});

test('MON04-TC-4 planned and Actual labels preserve incomplete, unknown, and exact zero', () => {
  assert.equal(plannedPeriodQuantityLabel(
    { state: 'COMPLETE', plannedQuantity: '0' }, 'm3'), '0 m3');
  assert.equal(plannedPeriodQuantityLabel({ state: 'INCOMPLETE', reason: 'PLAN_INCOMPLETE',
    knownPlannedQuantitySubtotal: '2.5' }, 'm3'), 'Belum lengkap \u2014 subtotal 2.5 m3');
  assert.equal(plannedPeriodQuantityLabel(
    { state: 'UNAVAILABLE', reason: 'NO_LOCKED_PLAN' }, 'm3'), 'TIDAK TERSEDIA');
  assert.equal(temporalActualQuantityLabel(
    { state: 'COMPLETE', currentOfficialQuantity: '0' }, 'm3'), '0 m3');
  assert.equal(temporalActualQuantityLabel(
    { state: 'NOT_YET_RECORDED' }, 'm3'), 'BELUM DICATAT');
  assert.equal(temporalActualQuantityLabel(
    { state: 'SEMANTICS_UNPROVEN' }, 'm3'), 'SEMANTIK BELUM TERBUKTI');
});

test('MON04-TC-5 Temporal Lens items join only by canonical boqItemId', () => {
  const items: MonitoringTemporalLensItem[] = [{
    boqItemId: 'boq-1',
    planned: {
      periodQuantity: { state: 'COMPLETE', plannedQuantity: '4' },
      cumulativeQuantityThroughEndDate: { state: 'COMPLETE', plannedQuantity: '7' },
    },
    actual: {
      periodOfficialQuantity: { state: 'COMPLETE', currentOfficialQuantity: '3' },
      cumulativeOfficialQuantityThroughEndDate: {
        state: 'COMPLETE', currentOfficialQuantity: '5',
      },
    },
  }];
  const byId = temporalLensItemsByBoqItemId(items);
  assert.equal(byId.get('boq-1')?.planned.periodQuantity.state, 'COMPLETE');
  assert.equal(byId.get('missing'), undefined);
});

test('MON04-TC-6 ProjectWorkPage owns one optional request and retires stale responses', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, /useState<TemporalContextMode>\('TERKINI'\)/);
  assert.match(page, /monitoringTemporalLensRequestPath\(\{/);
  assert.match(page, /const controller = new AbortController\(\)/);
  assert.match(page, /temporalRequestGenerationRef\.current !== generation/);
  assert.match(page, /controller\.abort\(\)/);
  for (const state of ['WAITING_INPUT', 'LOADING', 'RESOLVED', 'UNAVAILABLE', 'ERROR']) {
    assert.match(page, new RegExp(`state: '${state}'`));
  }
  assert.equal((page.match(/monitoringTemporalLensRequestPath\(\{/g) ?? []).length, 1);
});

test('MON04-TC-7 one Monitoring shell evolves without Current contamination', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  for (const control of ['Waktu Kerja', 'Kalender', 'Mingguan', 'Bulanan']) {
    assert.match(page, new RegExp(`>\\s*${control}\\s*<`));
  }
  assert.match(page, /aria-label="Konteks waktu"/);
  assert.match(page, /type="date"/);
  assert.match(page, /Rencana Periode/);
  assert.match(page, /Realisasi Resmi Periode/);
  assert.match(page, /Rencana s\.d\. Akhir Periode/);
  assert.match(page, /Realisasi Resmi s\.d\. Akhir Periode/);
  assert.match(page, /temporalLensItemsById\.get\(row\.id\)/);
  assert.match(page, /Kondisi Periode/);
  assert.match(page, /periodicResolvedLens\.weeklyRecap\.sliceCount/);
  assert.doesNotMatch(page, /weeklyRecap\.slices\.length/);
  assert.match(panel, /Schedule Rencana \+ Realisasi Periode/);
  assert.match(panel, /Kurva S untuk konteks periode belum diaktifkan/);
  assert.match(page, /temporalContextMode === 'TERKINI'[\s\S]*onChanged=/);
});

test('MON04-TC-8 candidate contains no frontend temporal or quantity math', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');
  const start = utility.indexOf('export function monitoringTemporalLensRequestPath');
  const end = utility.indexOf('export function plannedComparisonLabel');
  const helpers = utility.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const forbiddenMath = /Date\.now|new Date\(|getDay|getUTCDay|setDate|setUTCDate|getMonth|getUTCMonth|parseFloat\(|Number\(/;
  assert.doesNotMatch(page, forbiddenMath);
  assert.doesNotMatch(page,
    /periodQuantity\s*[/*+-]|plannedQuantity\s*[/*+-]|currentOfficialQuantity\s*[/*+-]/);
  assert.doesNotMatch(helpers,
    /Date\.now|new Date\(|getDay|getUTCDay|setDate|setUTCDate|getMonth|getUTCMonth|parseFloat\(|Number\(|Math\./);
  assert.doesNotMatch(helpers,
    /cutoffDate|includeProgressComparison|includeActualSeries|includePeriodWindow|periodStartDate|periodEndDate/);
});

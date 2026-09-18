import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  executionPlanBlockerLabel,
  executionPlanCurveUnavailableLabel,
  executionPlanPeriodCountLabel,
  executionPlanStatusLabel,
  periodicScheduleCoherence,
  periodicSchedulePlanDecision,
  type ExecutionPlanResponse,
} from './executionPlan.ts';
import type {
  MonitoringItem,
  MonitoringResponse,
  MonitoringTemporalLensItem,
} from './monitoringCurrent.ts';

const periodicBaseline = {
  id: 'baseline-b',
  versionNumber: 2,
  approvedAt: '2026-08-01T00:00:00.000Z',
};

function periodicWorkItem(id: string): MonitoringItem {
  const unavailableWeight = {
    state: 'UNAVAILABLE' as const,
    percentage: null,
    reason: 'ITEM_VALUE_UNAVAILABLE' as const,
  };
  return {
    id,
    parentId: null,
    wbsNodeId: null,
    wbsCode: `WBS-${id}`,
    name: `Pekerjaan ${id}`,
    itemType: 'WORK_ITEM',
    sortOrder: 1,
    planned: { quantity: '12', unit: 'm3' },
    weight: {
      own: unavailableWeight,
      subtree: unavailableWeight,
      cumulative: unavailableWeight,
    },
    currentOfficialQuantity: {
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    },
    currentOfficialItemProgress: {
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '33.333333',
      boundedContributionProgressPercent: '33.333333',
    },
    actual: null,
  };
}

function periodicTemporalItem(id: string): MonitoringTemporalLensItem {
  return {
    boqItemId: id,
    planned: {
      periodQuantity: { state: 'COMPLETE', plannedQuantity: '2' },
      cumulativeQuantityThroughEndDate: {
        state: 'COMPLETE',
        plannedQuantity: '6',
      },
    },
    actual: {
      periodOfficialQuantity: {
        state: 'COMPLETE',
        currentOfficialQuantity: '1',
      },
      cumulativeOfficialQuantityThroughEndDate: {
        state: 'COMPLETE',
        currentOfficialQuantity: '3',
      },
    },
  };
}

function periodicMonitoring(input: {
  projectId?: string;
  baseline?: MonitoringResponse['baseline'];
  lensBaseline?: MonitoringResponse['baseline'];
  planId?: string | null;
  planVersion?: number;
  items?: MonitoringItem[];
  temporalItems?: MonitoringTemporalLensItem[];
} = {}): MonitoringResponse {
  const baseline = input.baseline === undefined ? periodicBaseline : input.baseline;
  const items = input.items ?? [periodicWorkItem('work-1')];
  return {
    projectId: input.projectId ?? 'project-1',
    projectTimeZone: null,
    baseline,
    freshness: {
      dataThrough: { state: 'RECORDED', workDate: '2026-08-07' },
      lastRecordedAt: {
        state: 'RECORDED',
        recordedAt: '2026-08-07T08:00:00.000Z',
      },
    },
    weight: {
      basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST',
      completeness: 'UNAVAILABLE',
      reason: 'BASELINE_VALUE_UNAVAILABLE',
      denominator: { state: 'UNAVAILABLE', value: null },
      eligibleWorkItemCount: items.length,
      weightedWorkItemCount: 0,
      unavailableWorkItemCount: items.length,
    },
    currentOfficialRabWeightedPhysicalProgress: {
      state: 'UNAVAILABLE',
      reason: 'BASELINE_VALUE_UNAVAILABLE',
    },
    temporalLens: {
      mode: 'CANONICAL_MONITORING_TEMPORAL_LENS_V1',
      state: 'RESOLVED',
      basis: 'CALENDAR',
      granularity: 'WEEK',
      referenceDate: '2026-08-05',
      period: {
        basis: 'CALENDAR',
        granularity: 'WEEK',
        periodKey: '2026-W32',
        periodIndex: 32,
        startDate: '2026-08-03',
        endDate: '2026-08-09',
        metadata: {
          boundaryInclusivity: 'START_AND_END_INCLUSIVE',
          boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY',
          isoWeekYear: 2026,
          isoWeekNumber: 32,
        },
      },
      baseline:
        input.lensBaseline === undefined ? baseline : input.lensBaseline,
      plannedSource:
        input.planId === null
          ? null
          : {
              executionPlanVersionId: input.planId ?? 'plan-b',
              versionNumber: input.planVersion ?? 4,
              status: 'LOCKED',
            },
      plannedContext: { state: 'COMPLETE' },
      actualTruthMode:
        'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_EXPLICIT_WORKDATE_WINDOW',
      items:
        input.temporalItems ?? items.map((item) => periodicTemporalItem(item.id)),
    },
    items,
    unavailable: [],
  };
}

function executionPlanRead(input: {
  projectId?: string;
  baseline?: ExecutionPlanResponse['baseline'];
  planId?: string;
  planVersion?: number;
  status?: 'DRAFT' | 'LOCKED';
  scheduleItemIds?: string[];
} = {}): ExecutionPlanResponse {
  const status = input.status ?? 'LOCKED';
  return {
    projectId: input.projectId ?? 'project-1',
    projectStatus: 'ACTIVE',
    projectTimeZone: null,
    readinessState:
      status === 'LOCKED' ? 'LOCKED_FOR_EXECUTION' : 'REVISION_IN_PROGRESS',
    baseline: input.baseline === undefined ? periodicBaseline : input.baseline,
    plan: {
      id: input.planId ?? 'plan-b',
      versionNumber: input.planVersion ?? 4,
      revision: 1,
      status,
      predecessorId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      lastEditedAt: '2026-08-01T00:00:00.000Z',
      lockedAt: status === 'LOCKED' ? '2026-08-01T01:00:00.000Z' : null,
      lockedFromRevision: status === 'LOCKED' ? 1 : null,
      lockedFromProjectStatus: status === 'LOCKED' ? 'ACTIVE' : null,
      authority: null,
    },
    distributions: [],
    schedule: (input.scheduleItemIds ?? ['work-1']).map((boqItemId) => ({
      boqItemId,
      wbsCode: `STALE-${boqItemId}`,
      name: `Stale ${boqItemId}`,
      unit: 'stale-unit',
      baselineQuantity: '10',
      plannedQuantity: '10.000',
      plannedItemProgressPercent: null,
      plannedStartDate: '2026-08-01',
      plannedFinishDate: '2026-08-31',
    })),
    workPlan: [],
    plannedCurve: { state: 'COMPLETE', reason: null, points: [] },
    blockers: [],
    capabilities: {
      canEditDraft: false,
      canLock: false,
      editPermission: false,
      lockPermission: false,
      lockAuthority: null,
    },
  };
}

test('MON-04 readiness semantics remain distinct', () => {
  assert.equal(
    executionPlanStatusLabel('PLAN_NOT_READY'),
    'Rencana Pelaksanaan Belum Siap',
  );
  assert.equal(
    executionPlanStatusLabel('REVISION_IN_PROGRESS'),
    'Rencana Pelaksanaan Belum Dikunci',
  );
  assert.equal(
    executionPlanStatusLabel('READY_FOR_LOCK'),
    'Rencana Pelaksanaan Siap Dikunci',
  );
  assert.equal(
    executionPlanStatusLabel('LOCKED_FOR_EXECUTION'),
    'Rencana Pelaksanaan Terkunci',
  );
});

test('missing distribution is explained without becoming zero', () => {
  const label = executionPlanBlockerLabel({
    code: 'MISSING_WORK_ITEM_DISTRIBUTION',
    boqItemId: 'item-1',
  });
  assert.match(label, /belum tersedia/i);
  assert.doesNotMatch(label, /0|nol/i);
});

test('curve reasons stay machine-readable in state but human-readable in the panel', () => {
  assert.equal(
    executionPlanCurveUnavailableLabel('H2A1_WEIGHT_UNAVAILABLE'),
    'Kurva S Rencana belum tersedia karena bobot RAB resmi belum lengkap.',
  );
  assert.equal(
    executionPlanCurveUnavailableLabel(
      'LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION',
    ),
    'Proyek ini sudah aktif sebelum Rencana Pelaksanaan resmi tersedia di SIMPROK. Lengkapi dan kunci Rencana Pelaksanaan untuk melanjutkan pencatatan realisasi baru.',
  );
  assert.equal(
    executionPlanCurveUnavailableLabel('UNRECOGNIZED_INTERNAL_REASON'),
    'Kurva S Rencana belum tersedia karena data rencana belum lengkap.',
  );

  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  assert.match(panel, /executionPlanCurveUnavailableLabel/);
  assert.doesNotMatch(panel, /plannedCurve\.reason\}/);
  assert.doesNotMatch(
    executionPlanCurveUnavailableLabel('H2A1_WEIGHT_UNAVAILABLE'),
    /H2A1_WEIGHT_UNAVAILABLE/,
  );
  assert.doesNotMatch(
    executionPlanCurveUnavailableLabel(
      'LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION',
    ),
    /LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION/,
  );
});

test('period count distinguishes missing planning from positive interval counts', () => {
  assert.equal(executionPlanPeriodCountLabel(0), 'Belum dilengkapi');
  assert.equal(executionPlanPeriodCountLabel(1), '1 periode');
  assert.equal(executionPlanPeriodCountLabel(2), '2 periode');

  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  assert.match(panel, /Periode Rencana/);
  assert.match(panel, /executionPlanPeriodCountLabel\(row\.distributionCount\)/);
  assert.doesNotMatch(panel, /<td>\{row\.distributionCount\}<\/td>/);
});

test('legacy ACTIVE adoption is truthful and does not invent a second lifecycle', () => {
  assert.equal(
    executionPlanBlockerLabel({
      code: 'LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION',
    }),
    'Proyek ini sudah aktif sebelum Rencana Pelaksanaan resmi tersedia di SIMPROK. Lengkapi dan kunci Rencana Pelaksanaan untuk melanjutkan pencatatan realisasi baru.',
  );
  assert.equal(
    executionPlanBlockerLabel({
      code: 'EXECUTION_PLAN_DRAFT_NOT_FOUND',
    }),
    'Rencana Pelaksanaan belum dilengkapi.',
  );

  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  assert.match(panel, /Lengkapi Rencana Pelaksanaan/);
  assert.doesNotMatch(panel, /Susun Rencana/);
  assert.doesNotMatch(panel, /dan aktifkan proyek/);
  assert.doesNotMatch(panel, /downgrade|auto.?schedule/i);
});

test('canonical Monitoring consumes the backend plan API and keeps server authority', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );

  assert.match(page, /\/projects\/\$\{projectId\}\/execution-plan/);
  assert.match(page, /<ExecutionPlanReadinessPanel/);
  assert.match(panel, /Schedule Rencana/);
  assert.match(panel, /Rencana Kerja/);
  assert.match(panel, /Kurva S Rencana/);
  assert.match(panel, /hasPermission\('EXECUTION_PLAN_EDIT'\)/);
  assert.match(panel, /hasPermission\('EXECUTION_PLAN_LOCK'\)/);
  assert.match(panel, /executionPlan\.capabilities\.canLock/);
  assert.match(panel, /plannedIncrementalQuantity/);
  assert.doesNotMatch(panel, /plannedCumulativeQuantity|plannedWeight/);
  assert.doesNotMatch(panel, /parseFloat|parseInt|Math\.|DeviationService/);
  assert.doesNotMatch(panel, /Kurva S Realisasi|Forecast|Recovery/);
});

test('Schedule Rencana reuses parent-owned Monitoring facts by exact BoqItem id', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );

  assert.match(page, /monitoringWorkItemsById\(monitoring\?\.items \?\? \[\]\)/);
  assert.match(page, /realizationByBoqItemId=\{realizationByBoqItemId\}/);
  assert.equal((page.match(/\/progress\/monitoring/g) ?? []).length, 1);
  assert.match(panel, /Schedule Rencana \+ Realisasi Terkini/);
  assert.match(
    panel,
    /realizationByBoqItemId\.get\(row\.boqItemId\)/,
  );
  assert.match(panel, /scheduleRealizationPresentation/);
  assert.match(panel, /realization\.currentOfficialQuantity/);
  assert.match(panel, /realization\.currentOfficialItemProgress/);
  assert.match(panel, /realization\.effectiveWorkDate/);
  assert.match(panel, /realization\.quantityState/);
  assert.match(panel, /realization\.progressState/);
  assert.match(panel, /bukan Actual Start, Actual Finish, atau durasi aktual/);
  assert.doesNotMatch(panel, /progress\/monitoring/);
  assert.doesNotMatch(panel, /DeviationSignal|ProgressCard/);
  assert.doesNotMatch(panel, /parseFloat|parseInt|Math\.|\.toFixed\(/);
  assert.doesNotMatch(panel, /actual\s*-\s*planned|planned\s*-\s*actual/);
  assert.doesNotMatch(panel, /\.find\([^)]*(wbsCode|name)/s);
});
test('locked UI is read-only by state and no manual curve input exists', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );

  assert.match(panel, /const locked = executionPlan\.plan\?\.status === 'LOCKED'/);
  assert.match(panel, /Status Proyek:/);
  assert.match(panel, /\{!locked && !editing && \(/);
  assert.match(panel, /\{locked && executionPlan\.plan && \(/);
  assert.match(
    panel,
    /Monitoring menggunakan rencana[\s\S]+sebagai dasar Pengawasan dan Pengendalian/,
  );
  assert.doesNotMatch(panel, /input[^>]+curve|input[^>]+progress/i);
});

test('MON04 canonical comparator is parent-owned, optional, and requested once per context', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');

  assert.match(
    page,
    /monitoringComparisonCutoff\(\s*monitoringData\.freshness\.dataThrough/,
  );
  assert.match(page, /if \(cutoffDate === null\)/);
  assert.match(page, /state: 'MISSING_CUTOFF'/);
  assert.equal(
    (
      page.match(
        /apiFetch\(\s*monitoringComparisonRequestPath\(projectId, cutoffDate\)/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(page, /comparisonRequestRef\.current\?\.key/);
  assert.match(page, /comparisonRequestKey/);
  assert.match(page, /catch \(comparisonError\)/);
  assert.doesNotMatch(page, /includeActualSeries/);
  assert.doesNotMatch(page, /Date\.now|new Date\(/);

  assert.match(
    utility,
    /cutoffDate=' \+\s*cutoffDate \+\s*'&includeProgressComparison=true'/,
  );
  assert.doesNotMatch(utility, /includeActualSeries=true/);
  assert.doesNotMatch(panel, /progress\/monitoring/);
  assert.match(
    page,
    /progressComparisonPresentation=\{progressComparisonPresentation\}/,
  );
  assert.match(panel, /type MonitoringProgressComparisonPresentation/);
});

test('MON04 Kurva S consumes comparison points and preserves Planned-only fallback', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );

  assert.match(panel, /Rencana vs Realisasi/);
  assert.match(panel, /<svg/);
  assert.match(panel, /comparisonChart\.plannedSegments\.map/);
  assert.match(panel, /comparisonChart\.actualSegments\.map/);
  assert.match(panel, /comparison\.points\.map/);
  assert.match(panel, /<th>Tanggal<\/th>/);
  assert.match(panel, /<th>Rencana<\/th>/);
  assert.match(panel, /<th>Realisasi<\/th>/);
  assert.match(panel, /<th>Deviasi<\/th>/);
  assert.match(panel, /plannedComparisonLabel\(point\.planned\)/);
  assert.match(panel, /actualComparisonLabel\(point\.actual\)/);
  assert.match(
    panel,
    /deviationComparisonPresentation\(\s*point\.deviationPercentagePoints/,
  );
  assert.match(panel, /<time dateTime=\{point\.cutoffDate\}>/);
  assert.match(panel, /<h3>Kurva S Rencana<\/h3>/);
  assert.match(panel, /executionPlan\.plannedCurve\.points\.map/);
  assert.match(
    panel,
    /Kurva Realisasi belum tersedia karena belum ada tanggal data[\s\S]*pekerjaan yang berlaku/,
  );
  assert.match(panel, /Schedule Rencana \+ Realisasi Terkini/);
  assert.doesNotMatch(panel, /DeviationSignal|ProgressCard/);
});

test('MON04 changed production seam contains no duplicate domain calculation', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const utility = readFileSync('src/utils/monitoringCurrent.ts', 'utf8');
  const production = page + panel + utility;

  assert.doesNotMatch(production, /actual\s*-\s*planned|planned\s*-\s*actual/i);
  assert.doesNotMatch(production, /quantity\s*\/\s*plannedQuantity/i);
  assert.doesNotMatch(production, /weight\s*\*|\*\s*weight/i);
  assert.doesNotMatch(production, /includeActualSeries=true/);
  assert.doesNotMatch(production, /DeviationSignal|ProgressCard/);
  assert.doesNotMatch(production, /cumulative[^\n]*reduce|reduce[^\n]*cumulative/i);

  const chartStart = utility.indexOf(
    'export function monitoringComparisonChartProjection',
  );
  const chartEnd = utility.indexOf('export function lastRecordedLabel');
  const chartBlock = utility.slice(chartStart, chartEnd);
  assert.match(utility, /Presentation-only SVG projection/);
  assert.match(chartBlock, /Date\.parse/);
  assert.match(chartBlock, /Number\(value\)/);
  assert.doesNotMatch(chartBlock, /deviationPercentagePoints[^\n]*[-+]/);
});

test('MON04-PS-1 exact locked Plan provenance is coherent with one Periodic snapshot', () => {
  const periodicResponse = periodicMonitoring();
  const executionPlan = executionPlanRead();
  const result = periodicScheduleCoherence({ periodicResponse, executionPlan });
  assert.equal(result.state, 'COHERENT');
  if (result.state === 'COHERENT') {
    assert.equal(result.executionPlan, executionPlan);
    assert.equal(result.lens, periodicResponse.temporalLens);
  }
});

test('MON04-PS-2 project and exact Baseline identity mismatches fail closed', () => {
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring(),
      executionPlan: executionPlanRead({ projectId: 'project-other' }),
    }),
    { state: 'INCOHERENT', reason: 'PROJECT_ID_MISMATCH' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring(),
      executionPlan: executionPlanRead({
        baseline: { ...periodicBaseline, id: 'baseline-a' },
      }),
    }),
    { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_BASELINE_MISMATCH' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring(),
      executionPlan: executionPlanRead({
        baseline: {
          ...periodicBaseline,
          approvedAt: '2026-08-02T00:00:00.000Z',
        },
      }),
    }),
    { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_BASELINE_MISMATCH' },
  );
});

test('MON04-PS-3 Draft, wrong Plan id, and wrong Plan version never satisfy plannedSource', () => {
  const periodicResponse = periodicMonitoring();
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse,
      executionPlan: executionPlanRead({ status: 'DRAFT' }),
    }),
    { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_NOT_LOCKED' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse,
      executionPlan: executionPlanRead({ planId: 'plan-a' }),
    }),
    { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_ID_MISMATCH' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse,
      executionPlan: executionPlanRead({ planVersion: 3 }),
    }),
    { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_VERSION_MISMATCH' },
  );
});

test('MON04-PS-4 Schedule joins only exact unique boqItemId from the same RAB and lens', () => {
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring(),
      executionPlan: executionPlanRead({ scheduleItemIds: ['work-1', 'work-1'] }),
    }),
    { state: 'INCOHERENT', reason: 'DUPLICATE_SCHEDULE_ITEM_ID' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring(),
      executionPlan: executionPlanRead({ scheduleItemIds: ['work-999'] }),
    }),
    { state: 'INCOHERENT', reason: 'SCHEDULE_ITEM_NOT_IN_PERIODIC_RAB' },
  );
  assert.deepEqual(
    periodicScheduleCoherence({
      periodicResponse: periodicMonitoring({ temporalItems: [] }),
      executionPlan: executionPlanRead(),
    }),
    { state: 'INCOHERENT', reason: 'SCHEDULE_ITEM_NOT_IN_TEMPORAL_LENS' },
  );
});

test('MON04-PS-5 smart reuse avoids reads when proof exists or plannedSource is absent', () => {
  const periodicResponse = periodicMonitoring();
  const exactPlan = executionPlanRead();
  assert.deepEqual(
    periodicSchedulePlanDecision({
      periodicResponse,
      candidates: [exactPlan],
    }),
    { state: 'REUSE', executionPlan: exactPlan },
  );
  assert.deepEqual(
    periodicSchedulePlanDecision({
      periodicResponse: periodicMonitoring({ planId: null }),
      candidates: [exactPlan],
    }),
    { state: 'NO_PLANNED_SOURCE' },
  );
});

test('MON04-PS-6 Plan A is refreshed once before Plan B may satisfy Lens B', () => {
  const periodicResponseB = periodicMonitoring({ planId: 'plan-b', planVersion: 4 });
  const planA = executionPlanRead({ planId: 'plan-a', planVersion: 3 });
  assert.deepEqual(
    periodicSchedulePlanDecision({
      periodicResponse: periodicResponseB,
      candidates: [planA],
    }),
    { state: 'REFRESH_REQUIRED' },
  );
  assert.equal(
    periodicScheduleCoherence({
      periodicResponse: periodicResponseB,
      executionPlan: executionPlanRead({ planId: 'plan-b', planVersion: 4 }),
    }).state,
    'COHERENT',
  );
  assert.equal(
    periodicScheduleCoherence({
      periodicResponse: periodicResponseB,
      executionPlan: planA,
    }).state,
    'INCOHERENT',
  );
});

test('MON04-PS-7 Periodic Schedule presents backend facts and keeps Current path intact', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const start = panel.indexOf('function PeriodicScheduleReadOnly');
  const end = panel.indexOf('export function ExecutionPlanReadinessPanel', start);
  const periodicBlock = panel.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const heading of [
    'Schedule Rencana + Realisasi Periode',
    'Rencana Mulai',
    'Rencana Selesai',
    'Rencana Periode',
    'Realisasi Resmi Periode',
    'Rencana s.d. Akhir Periode',
    'Realisasi Resmi s.d. Akhir Periode',
  ]) {
    assert.ok(periodicBlock.includes(heading));
  }
  assert.match(periodicBlock, /periodicItemsById\.get\(row\.boqItemId\)/);
  assert.match(periodicBlock, /temporalItemsById\.get\(row\.boqItemId\)/);
  assert.match(periodicBlock, /row\.plannedStartDate/);
  assert.match(periodicBlock, /row\.plannedFinishDate/);
  assert.match(periodicBlock, /plannedPeriodQuantityLabel/);
  assert.match(periodicBlock, /temporalActualQuantityLabel/);
  assert.match(periodicBlock, /aria-pressed=\{periodicView === 'schedule'\}/);
  assert.match(periodicBlock, /aria-pressed=\{periodicView === 'curve'\}/);
  assert.match(periodicBlock, /Rencana vs Realisasi s\.d\. Akhir Periode/);
  assert.doesNotMatch(periodicBlock, /scheduleRealizationPresentation/);
  assert.doesNotMatch(periodicBlock, /currentOfficialItemProgress/);
  assert.doesNotMatch(periodicBlock, /Edit Rencana|Simpan Draft|Kunci Plan/);
  assert.match(page, /temporalContextMode === 'TERKINI'[\s\S]*onChanged=/);
  assert.match(panel, /Schedule Rencana \+ Realisasi Terkini/);
  assert.match(panel, /Rencana Kerja/);
  assert.match(panel, /Kurva S Rencana/);
});

test('MON04-PS-8 refresh is bounded, abortable, and guarded against stale Plan responses', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  const start = page.indexOf('const periodicScheduleRequestKey');
  const end = page.indexOf('const activatePeriodicContext', start);
  const connection = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(
    (connection.match(/apiFetch\(`\/projects\/\$\{projectId\}\/execution-plan`/g) ?? [])
      .length,
    1,
  );
  assert.match(connection, /periodicSchedulePlanDecision/);
  assert.match(connection, /periodicScheduleRequestRef\.current\?\.key/);
  assert.match(connection, /periodicScheduleGenerationRef\.current !== generation/);
  assert.match(connection, /controller\.abort\(\)/);
  assert.match(connection, /setPeriodicSchedulePlanCache\(freshExecutionPlan\)/);
  assert.doesNotMatch(connection, /setInterval|setTimeout/);
});

test('MON04-PS-9 Periodic Schedule connection adds no business math or duplicate engine', () => {
  const utility = readFileSync('src/utils/executionPlan.ts', 'utf8');
  const utilityStart = utility.indexOf('export type PeriodicScheduleCoherence');
  const utilityEnd = utility.indexOf('export function executionPlanStatusLabel');
  const helperBlock = utility.slice(utilityStart, utilityEnd);
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const panelStart = panel.indexOf('interface MonitoringComparisonCurveProps');
  const panelEnd = panel.indexOf('export function ExecutionPlanReadinessPanel', panelStart);
  const production = helperBlock + panel.slice(panelStart, panelEnd);
  assert.doesNotMatch(
    production,
    /Date\.now|new Date\(|getDay|getUTCDay|getMonth|getUTCMonth|setDate|setUTCDate|Number\(|parseFloat\(|Math\./,
  );
  assert.doesNotMatch(
    production,
    /periodQuantity\s*[/*+-]|plannedQuantity\s*[/*+-]|currentOfficialQuantity\s*[/*+-]/,
  );
  assert.doesNotMatch(
    production,
    /resolveCanonicalTemporalPeriod|canonicalWeekSlicesForMonth|periodEndDate\s*[<>=]|workDate\s*[<>=]/,
  );
});

test('MON04-PK-P1 Current and Periodic reuse exactly one Kurva renderer', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  assert.equal((panel.match(/<svg/g) ?? []).length, 1);
  assert.match(
    panel,
    /monitoringComparisonChartProjection\(comparison\.points\)/,
  );
  assert.equal(
    (panel.match(/<MonitoringComparisonCurve/g) ?? []).length,
    2,
  );
  assert.match(panel, /contextLine=\{`TERKINI · Data sampai/);
  assert.match(
    panel,
    /contextLine=\{`\$\{monitoringTemporalPeriodLabel\(lens\.period\)\} · s\.d\./,
  );
});

test('MON04-PK-P2 Periodic Kurva uses cumulative backend wording and supplied deviation', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const start = panel.indexOf('function PeriodicScheduleReadOnly');
  const end = panel.indexOf('export function ExecutionPlanReadinessPanel', start);
  const periodicBlock = panel.slice(start, end);
  for (const label of [
    'Rencana vs Realisasi s.d. Akhir Periode',
    'Rencana s.d. akhir periode',
    'Realisasi s.d. akhir periode',
    'Deviasi s.d. akhir periode',
  ]) {
    assert.ok(periodicBlock.includes(label));
  }
  assert.match(
    periodicBlock,
    /comparison=\{comparisonPresentation\.comparison\}/,
  );
  assert.doesNotMatch(
    periodicBlock,
    /Progress Minggu ini|Progress Periode|Deviasi Periode/,
  );

  const rendererStart = panel.indexOf('function MonitoringComparisonCurve');
  const rendererEnd = panel.indexOf('function PeriodicScheduleReadOnly', rendererStart);
  const renderer = panel.slice(rendererStart, rendererEnd);
  assert.match(
    renderer,
    /deviationComparisonPresentation\(\s*finalComparisonPoint\.deviationPercentagePoints/,
  );
  assert.doesNotMatch(renderer, /actual\s*-\s*planned|planned\s*-\s*actual/i);
});

test('MON04-PK-P3 Periodic Kurva states fail closed without hiding healthy Schedule', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const start = panel.indexOf('function PeriodicScheduleReadOnly');
  const end = panel.indexOf('export function ExecutionPlanReadinessPanel', start);
  const periodicBlock = panel.slice(start, end);
  assert.match(periodicBlock, /periodicView === 'schedule'/);
  assert.match(periodicBlock, /periodicView === 'curve'/);
  assert.match(
    periodicBlock,
    /Kurva S periode tidak dapat ditampilkan karena konteks RAB,[\s\S]*rencana, dan perbandingan tidak konsisten/,
  );
  assert.match(
    periodicBlock,
    /Kurva S periode gagal dimuat\. Fakta periode lainnya tetap aman/,
  );
  assert.doesNotMatch(periodicBlock, /Simpan Draft|Kunci Rencana Pelaksanaan/);
});

test('MON04-PK-P4 renderer consumes backend points without synthetic period data', () => {
  const panel = readFileSync(
    'src/pages/field/ExecutionPlanReadinessPanel.tsx',
    'utf8',
  );
  const start = panel.indexOf('function MonitoringComparisonCurve');
  const end = panel.indexOf('function PeriodicScheduleReadOnly', start);
  const renderer = panel.slice(start, end);
  assert.match(renderer, /comparison\.points\.map/);
  assert.match(renderer, /point\.cutoffDate/);
  assert.doesNotMatch(
    renderer,
    /period\.startDate|period\.endDate|push\(|unshift\(|interpol|prorat|resampl/i,
  );
});

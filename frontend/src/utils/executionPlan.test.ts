import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  executionPlanBlockerLabel,
  executionPlanCurveUnavailableLabel,
  executionPlanPeriodCountLabel,
  executionPlanStatusLabel,
} from './executionPlan.ts';

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

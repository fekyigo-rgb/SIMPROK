import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  executionPlanBlockerLabel,
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

test('legacy ACTIVE adoption is truthful and does not invent a second lifecycle', () => {
  assert.equal(
    executionPlanBlockerLabel({
      code: 'LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION',
    }),
    'Proyek ini sudah aktif sebelum Rencana Pelaksanaan resmi tersedia di SIMPROK. Susun dan kunci Rencana Pelaksanaan untuk melanjutkan pencatatan realisasi baru.',
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

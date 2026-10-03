import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { executionPlanBlockerLabel } from '../utils/executionPlan.ts';

const app = readFileSync('src/App.tsx', 'utf8');
const page = readFileSync('src/pages/ScheduleHomePage.tsx', 'utf8');
const detailDoor = readFileSync('src/pages/ProjectDetailDoorPage.tsx', 'utf8');
const rabDoor = readFileSync('src/pages/ProjectRabDoorPage.tsx', 'utf8');
const monitoringPage = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
const governancePanel = readFileSync(
  'src/pages/field/ExecutionPlanReadinessPanel.tsx',
  'utf8',
);

test('SH-01 route is a PROJECT_VIEW-gated project workspace', () => {
  assert.match(app, /import \{ ScheduleHomePage \} from '\.\/pages\/ScheduleHomePage';/);
  assert.match(
    app,
    /path="project\/:projectId\/schedule"[\s\S]{0,120}permission="PROJECT_VIEW"[\s\S]{0,80}<ScheduleHomePage/,
  );
});

test('Schedule Home reads Project and canonical Execution Plan without Monitoring transport', () => {
  assert.match(page, /apiFetch\(`\/projects\/\$\{projectId\}`/);
  assert.match(page, /apiFetch\(`\/projects\/\$\{projectId\}\/execution-plan`/);
  assert.equal((page.match(/apiFetch\(/g) ?? []).length, 2);
  assert.doesNotMatch(page, /progress\/monitoring|temporal-lens|period-navigator|progress-comparison/);
  assert.doesNotMatch(
    page,
    /executionPlan\.(actual|deviation)|monitoringResponse|progressComparison/,
  );
});

test('Schedule Home reuses governance with an exact non-Monitoring prop branch', () => {
  assert.match(governancePanel, /interface GovernanceExecutionPlanReadinessPanelProps/);
  assert.match(governancePanel, /presentation: 'GOVERNANCE';/);
  assert.match(governancePanel, /interface CurrentMonitoringExecutionPlanReadinessPanelProps/);
  assert.match(page, /<ExecutionPlanReadinessPanel[\s\S]{0,180}presentation="GOVERNANCE"/);

  const scheduleCall = page.slice(
    page.indexOf('<ExecutionPlanReadinessPanel'),
    page.indexOf('/>', page.indexOf('<ExecutionPlanReadinessPanel')) + 2,
  );
  assert.doesNotMatch(scheduleCall, /realizationByBoqItemId|progressComparisonPresentation/);
  assert.match(governancePanel, /hasPermission\('EXECUTION_PLAN_EDIT'\)/);
  assert.match(governancePanel, /hasPermission\('EXECUTION_PLAN_LOCK'\)/);
  assert.match(governancePanel, /\/execution-plan\/draft/);
  assert.match(governancePanel, /\/execution-plan\/lock/);
});

test('Schedule and Planned Curve present backend fields without frontend planning math', () => {
  assert.match(page, /executionPlan\.schedule\.map\(\(row\) =>/);
  for (const field of [
    'row.wbsCode',
    'row.name',
    'row.plannedStartDate',
    'row.plannedFinishDate',
    'row.plannedQuantity',
    'row.unit',
  ]) {
    assert.ok(page.includes(field), `${field} is not presented`);
  }
  assert.match(page, /executionPlan\.plannedCurve\.points\.map\(\(point\) =>/);
  assert.match(page, /point\.knownWeightedPlannedProgressPercent/);
  assert.match(page, /executionPlanCurveUnavailableLabel\(executionPlan\.plannedCurve\.reason\)/);
  assert.doesNotMatch(page, /parseFloat|parseInt|Math\.|\.reduce\(|\.toFixed\(|new Date\(/);
  assert.doesNotMatch(page, /plannedCumulativeQuantity|plannedWeight|monitoringComparisonChartProjection/);
});

test('PLAN_NOT_READY, empty distributions, and unavailable curves stay honest', () => {
  assert.match(page, /executionPlanStatusLabel\(executionPlan\.readinessState\)/);
  assert.match(page, /Distribusi waktu belum tersedia\./);
  assert.match(page, /executionPlan\.plannedCurve\.state === 'UNAVAILABLE'/);
  assert.match(governancePanel, /executionPlan\.blockers\.map/);
  assert.match(page, /Memuat Schedule…/);
  assert.match(page, /Project tidak ditemukan\./);
  assert.match(page, /Anda tidak memiliki akses ke proyek ini\./);
  assert.match(page, /Muat Ulang/);
});

test('PLANNED plus LOCKED remains lawful and Start Execution is not exposed', () => {
  assert.match(page, /<dt>Status Proyek<\/dt>[\s\S]{0,100}executionPlan\.projectStatus/);
  assert.match(page, /executionPlanStatusLabel\(executionPlan\.readinessState\)/);
  assert.equal(
    executionPlanBlockerLabel({ code: 'LOCKED_PLAN_PROJECT_NOT_ACTIVE' }),
    'Pelaksanaan proyek belum dimulai. Rencana Pelaksanaan tetap terkunci dan dapat dibaca.',
  );
  assert.doesNotMatch(page, /start-execution|Mulai Pelaksanaan/);
  assert.doesNotMatch(page, /projectStatus\s*===\s*'ACTIVE'/);
});

test('Detail Project exposes one live Schedule door only for API-backed projects', () => {
  assert.match(detailDoor, /navigate\(`\/project\/\$\{projectId\}\/schedule`\)/);
  assert.match(detailDoor, /disabled=\{!isApiProject \|\| !projectId\}/);
  assert.match(detailDoor, />\s*Buka Schedule\s*\{/);
  assert.match(detailDoor, /Schedule tidak tersedia untuk data contoh\./);
  assert.doesNotMatch(detailDoor, /Menunggu mesin Schedule\./);
  assert.match(detailDoor, /const isScheduleDoor = docName === 'Schedule \/ Jadwal'/);
  assert.match(detailDoor, /if \(scheduleDoorLive\) \{[\s\S]{0,80}openSchedule\(\)/);
});

test('RAB Schedule support door is live while other support doors remain unchanged', () => {
  assert.match(rabDoor, /doc === 'Schedule \/ Jadwal' && projectId/);
  assert.match(rabDoor, /navigate\(`\/project\/\$\{projectId\}\/schedule`\)/);
  assert.match(rabDoor, /doc === 'Schedule \/ Jadwal' \? 'Buka Schedule' : 'Belum tersedia'/);
  for (const unchangedDoor of [
    'Spesifikasi Teknis',
    'RKK',
    'Peralatan Utama',
    'Metode Pelaksanaan',
    'TKDN',
  ]) {
    assert.ok(rabDoor.includes(`'${unchangedDoor}'`), `${unchangedDoor} door changed`);
  }
});

test('Monitoring keeps its own comparison consumer and the same Execution Plan response', () => {
  assert.match(monitoringPage, /\/projects\/\$\{projectId\}\/progress\/monitoring/);
  assert.match(monitoringPage, /\/projects\/\$\{projectId\}\/execution-plan/);
  assert.match(monitoringPage, /presentation=\{monitoringPlanView\}/);
  assert.match(monitoringPage, /realizationByBoqItemId=\{realizationByBoqItemId\}/);
  assert.match(
    monitoringPage,
    /progressComparisonPresentation=\{progressComparisonPresentation\}/,
  );
  assert.match(governancePanel, /Schedule Rencana \+ Realisasi Terkini/);
  assert.match(governancePanel, /Rencana vs Realisasi/);
});

test('Schedule Home distinguishes backend conflict from a neutral load failure', () => {
  assert.match(page, /error\.status === 409/);
  assert.match(
    page,
    /Schedule dihentikan karena konteks Rencana Pelaksanaan tidak konsisten\./,
  );
  assert.match(page, /Schedule belum dapat dimuat\. Muat ulang atau coba lagi\./);
  assert.doesNotMatch(page, /Periksa koneksi/);
});

test('Detail Project keeps project inputs distinct from Schedule item dates', () => {
  assert.equal((detailDoor.match(/Usulan Hari 1 Pelaksanaan/g) ?? []).length, 2);
  assert.equal((detailDoor.match(/Target Selesai/g) ?? []).length, 2);
  assert.doesNotMatch(detailDoor, /label: 'Rencana Mulai(?: \*)?'/);
  assert.doesNotMatch(detailDoor, /label: 'Rencana Selesai(?: \*)?'/);
  assert.match(page, /<th>Rencana Mulai<\/th>/);
  assert.match(page, /<th>Rencana Selesai<\/th>/);
});

test('Detail document copy recognizes the live Schedule workspace', () => {
  assert.match(detailDoor, /Dokumen pendukung lain dapat dibuka sebagai preview baca cepat\./);
  assert.match(detailDoor, /Schedule membuka Ruang[\s\S]{0,20}Schedule proyek\./);
  assert.match(
    detailDoor,
    /Perubahan dilakukan pada ruang kerja masing-masing sesuai kewenangan\./,
  );
  assert.doesNotMatch(detailDoor, /Pintu dokumen dari Detail Proyek adalah preview baca cepat/);
  assert.doesNotMatch(detailDoor, /Edit dokumen tetap melalui[\s\S]{0,20}Ruang RAB/);
});

test('Schedule Home opts into the single locked Rencana Kerja renderer', () => {
  assert.match(governancePanel, /showWorkPlanWhenLocked\?: boolean/);
  assert.match(governancePanel, /\{\(!locked \|\| showWorkPlanWhenLocked\) && \(/);
  assert.equal((governancePanel.match(/<h3>Rencana Kerja<\/h3>/g) ?? []).length, 1);
  const scheduleGovernanceCall = page.slice(
    page.indexOf('<ExecutionPlanReadinessPanel'),
    page.indexOf('/>', page.indexOf('<ExecutionPlanReadinessPanel')) + 2,
  );
  assert.match(scheduleGovernanceCall, /showWorkPlanWhenLocked/);
  const monitoringGovernanceCall = monitoringPage.slice(
    monitoringPage.indexOf('<ExecutionPlanReadinessPanel'),
    monitoringPage.indexOf('/>', monitoringPage.indexOf('<ExecutionPlanReadinessPanel')) + 2,
  );
  assert.doesNotMatch(monitoringGovernanceCall, /showWorkPlanWhenLocked/);
});

test('Locked governance note is context-neutral and points to Jadwal Rencana', () => {
  assert.match(governancePanel, /Rencana Pelaksanaan telah dikunci\./);
  assert.match(governancePanel, /Monitoring menggunakan rencana/);
  assert.match(governancePanel, /Distribusi waktu[\s\S]{0,80}Jadwal Rencana\./);
  assert.doesNotMatch(governancePanel, /Jadwal pada detail pekerjaan/);
});

test('RAB keeps direct Schedule navigation without an unreachable preview branch', () => {
  assert.doesNotMatch(rabDoor, /activeSupport === 'Schedule \/ Jadwal'/);
  assert.match(rabDoor, /doc === 'Schedule \/ Jadwal' && projectId/);
  assert.match(rabDoor, /navigate\(`\/project\/\$\{projectId\}\/schedule`\)/);
});

test('Schedule Home keeps implementation vocabulary out of user-visible copy', () => {
  const userVisibleText = [...page.matchAll(/>([^<{]+)</g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join(' ');

  assert.doesNotMatch(userVisibleText, /\b(?:backend|plannedCurve|canonical|governance|readiness)\b/i);
  assert.doesNotMatch(userVisibleText, /\bExecution Plan\b/i);
  assert.match(page, /<dt>Rencana Pelaksanaan<\/dt>/);
  assert.match(page, /Kesiapan, Rencana Kerja, revisi, dan penguncian menggunakan Rencana Pelaksanaan yang sama\./);
  assert.match(page, /Tanggal dan kuantitas berasal dari Rencana Pelaksanaan proyek\./);
  assert.match(page, /Kurva S Rencana berasal dari Rencana Pelaksanaan proyek; tanpa Realisasi atau Deviasi\./);
  assert.doesNotMatch(page, /Rencana Pelaksanaan resmi/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');

test('import door does not open old server jobs as a newly selected file', () => {
  assert.match(page, /const \[savedImportsOpen, setSavedImportsOpen\] = useState\(false\)/);
  assert.match(page, /const \[selectedSavedImport, setSelectedSavedImport\] = useState<string \| null>\(null\)/);
  assert.match(page, /placeOutcomes\(waitingImports/);
  assert.match(page, /entry\.item\.key === selectedSavedImport/);
  assert.match(page, /Pekerjaan import sebelumnya/);
  assert.match(page, /'Lihat pekerjaan tersimpan'/);
  assert.match(page, /onClick=\{\(\) => openSavedImport\(job\.key\)\}/);
  assert.match(page, /kind: 'importJobId', importJobId/);
  assert.match(page, /setObservationScope\(scope\)/);
});

test('three navigation choices are separate from canonical AHSP commit', () => {
  assert.match(page, /useBlocker\(hasUnsavedWork\)/);
  assert.match(page, /const hasUnsavedPreviewChoices = !settled && Object\.keys\(decisions\)\.length > 0/);
  assert.match(page, /hasUnsavedUpload \|\| hasUnsavedPreviewChoices \|\| hasUnsavedSavedJobChoices/);
  assert.match(page, /saveAsDraft\(true\)/);
  assert.match(page, /leaveAfterSave && Object\.keys\(decisions\)\.length === 0/);
  assert.match(page, /Object.keys\(jobDecisions\).length > 0/);
  assert.match(page, /addEventListener\('beforeunload'/);
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /Tetap di halaman/);
  assert.match(page, /Simpan sebagai draft/);
  assert.match(page, /Tinggalkan tanpa menyimpan/);
  assert.match(page, /navigationBlocker\.reset\(\)/);
  assert.match(page, /navigationBlocker\.proceed\(\)/);
  const draft = page.slice(page.indexOf('const saveAsDraft = async (leaveAfterSave = false) =>'), page.indexOf('const commitDocument = async () =>'));
  assert.match(draft, /\/ahsp\/document\/intake/);
  assert.match(draft, /\/assisted-classification/);
  assert.match(draft, /if \(!check\.ok\)/);
  assert.doesNotMatch(draft, /\/ahsp\/document\/commit/);
  const commit = page.slice(page.indexOf('const commitDocument = async () =>'));
  assert.match(commit, /\/ahsp\/document\/commit/);
});

test('unsaved local decisions are explicitly disclosed and no job data is deleted', () => {
  assert.match(page, /Pilihan kesamaan sementara yang belum dikomit tidak ikut tersimpan/);
  assert.match(page, /tanpa menjadikannya AHSP siap digunakan/);
  assert.doesNotMatch(page, /method: 'DELETE'[\s\S]*\/ahsp\/document\/jobs/);
  assert.match(page, /setFile\(null\)/);
  assert.match(page, /setPreviewIntakeJobId\(null\)/);
  assert.match(page, /Keputusan satuan sebelumnya sudah dicatat dalam jurnal SIMPROK/);
  assert.match(page, /draft tetap tersimpan/);
  assert.match(page, /Batalkan import baru/);
  assert.match(page, /Catatan yang sudah tersimpan di SIMPROK tetap ada/);
  assert.match(page, /disabled=\{!file \|\| draftBusy \|\| importing \|\| draftSaved\}/);
  assert.match(page, /if \(preview && \(hasUnsavedUpload \|\| hasUnsavedPreviewChoices\)\)/);
  assert.match(page, /window\.confirm\('Periksa ulang akan mencoba MENYIMPAN AHSP/);
  const savedJobContinuation = page.slice(page.indexOf('const recheckImport = async'), page.indexOf('const shownQuestions ='));
  assert.match(savedJobContinuation, /const assistedClassification = null/);
  assert.match(savedJobContinuation, /body: JSON.stringify\(\{ decisions, assistedClassification \}\)/);
});

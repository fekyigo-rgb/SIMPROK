import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');

test('import door does not open old server jobs as a newly selected file', () => {
  assert.match(page, /const \[savedImportsOpen, setSavedImportsOpen\] = useState\(false\)/);
  assert.match(page, /const \[selectedSavedImport, setSelectedSavedImport\] = useState<string \| null>\(null\)/);
  assert.match(page, /placeOutcomes\(waitingImports/);
  assert.match(page, /const effectiveSavedImportId = isReviewPage \? reviewJobId : selectedSavedImport/);
assert.match(page, /entry\.item\.key === effectiveSavedImportId/);
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

test('Owner-approved leave dialog keeps its explanations in the save tooltip, not permanent copy', () => {
  const modal = page.slice(page.indexOf('role="alertdialog"'), page.indexOf('{/* Manual AHSP create'));
  const beforeTooltip = modal.slice(0, modal.indexOf('id="ahsp-draft-save-tooltip"'));
  const tooltip = modal.slice(modal.indexOf('id="ahsp-draft-save-tooltip"'), modal.indexOf('</span>', modal.indexOf('id="ahsp-draft-save-tooltip"')));
  const styles = readFileSync('src/styles/ahsp.css', 'utf8');
  assert.doesNotMatch(modal, /SIMPROK tidak akan diam-diam menerima AHSP atau menghapus catatan yang sudah tersimpan/);
  assert.doesNotMatch(beforeTooltip, /Simpan sebagai draft merekam dokumen dan konteks klasifikasi di server/);
  assert.match(tooltip, /Simpan sebagai draft merekam dokumen dan konteks klasifikasi di server/);
  assert.match(tooltip, /Pilihan kesamaan sementara yang belum dikomit tidak ikut tersimpan/);
  assert.match(tooltip, /Tinggalkan tanpa menyimpan tidak menghapus dokumen maupun AHSP yang sudah tercatat/);
  assert.match(modal, /aria-describedby="ahsp-draft-save-tooltip"/);
  assert.match(tooltip, /role="tooltip"/);
  assert.match(styles, /\.ahsp-draft-save-help:hover > \.ahsp-draft-save-help__tooltip/);
  assert.match(styles, /\.ahsp-draft-save-help:focus-within > \.ahsp-draft-save-help__tooltip/);
  assert.match(styles, /visibility: hidden/);
});

test('unsaved local decisions are disclosed and draft deletion is separate from canonical AHSP', () => {
  assert.match(page, /Pilihan kesamaan sementara yang belum dikomit tidak ikut tersimpan/);
  assert.match(page, /tanpa menjadikannya AHSP siap digunakan/);
  assert.match(page, /apiFetch\('\/ahsp\/document\/jobs\/' \+ job\.key \+ '\/draft', \{\s*method: 'DELETE'/);
  const deletionLogic = page.slice(page.indexOf('const deleteUnfinishedDraft = async'), page.indexOf('const shownQuestions ='));
  assert.doesNotMatch(deletionLogic, /window\.confirm/);
  assert.match(deletionLogic, /setDraftDeleteTarget\(null\)/);
  assert.match(page, /setDraftDeleteTarget\(job\)/);
  assert.match(page, /role="alertdialog"[\s\S]*?id="ahsp-draft-delete-title"/);
  assert.match(page, /Batal[\s\S]*?Hapus \{draftDeleteTarget\.waitingItems\.length\} draft/);
  assert.match(page, /AHSP dan resource yang sudah tersimpan tetap aman/);
  assert.match(page, /job\.waitingItems\.length > 0/);
  assert.match(page, /className="ahsp-action ahsp-action--danger ahsp-action--compact"[\s\S]*?Hapus draft/);
  assert.match(page, /Periksa & simpan yang siap/);
  assert.match(page, /setFile\(null\)/);
  assert.match(page, /setPreviewIntakeJobId\(null\)/);
  assert.match(page, /Keputusan satuan sebelumnya sudah dicatat dalam jurnal SIMPROK/);
  assert.match(page, /draft tetap tersimpan/);
  assert.match(page, /Batalkan import baru/);
  assert.match(page, /Catatan yang sudah tersimpan di SIMPROK tetap ada/);
  assert.match(page, /disabled=\{!file \|\| draftBusy \|\| importing \|\| draftSaved\}/);
  assert.match(page, /if \(preview && \(hasUnsavedUpload \|\| hasUnsavedPreviewChoices\)\)/);
  assert.match(page, /window\.confirm\('Periksa dan simpan AHSP yang sudah memenuhi syarat/);
  const savedJobContinuation = page.slice(page.indexOf('const recheckImport = async'), page.indexOf('const shownQuestions ='));
  assert.match(savedJobContinuation, /const assistedClassification = null/);
  assert.match(savedJobContinuation, /body: JSON.stringify\(\{ decisions, assistedClassification \}\)/);
});

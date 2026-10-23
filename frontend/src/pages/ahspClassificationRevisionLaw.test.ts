import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/AhspClassificationRevisionPanel.tsx', 'utf8');
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');

test('classification revision reuses the existing picker and assignment routes', () => {
  assert.ok(panel.includes('AhspImportAssistedClassificationPanel'));
  assert.ok(panel.includes('showMetadata={false}'));
  assert.ok(panel.includes('/classification-assignments'));
  assert.ok(panel.includes('/deactivate'));
  assert.ok(detail.includes('AhspClassificationRevisionPanel'));
});

test('only HUMAN_ADDED paths expose deactivation; source-derived evidence stays visible', () => {
  assert.ok(panel.includes("assignment.provenance === 'HUMAN_ADDED'"));
  assert.ok(panel.includes('Dari sumber — dipertahankan'));
  assert.ok(panel.includes('Hapus pilihan klasifikasi'));
});
test('re-add posts leaf ids to the existing server writer, never a local taxonomy', () => {
  assert.ok(panel.includes('leafNodeIds'));
  assert.ok(panel.includes('draft.paths.map'));
  assert.ok(!panel.includes('Bina Marga'));
  assert.ok(!panel.includes('Cipta Karya'));
});

test('classification panel shares the exact successful assignment read with Informasi AHSP', () => {
  assert.ok(panel.includes('onAssignmentsChange?: (rows: readonly ClassificationAssignment[]) => void'));
  assert.ok(panel.includes('onAssignmentsChange?.(activeRows)'));
  assert.ok(panel.includes('}, [ahspId, onAssignmentsChange])'));
  assert.ok(detail.includes('onAssignmentsChange={onClassificationAssignmentsChange}'));
  assert.ok(detail.includes('setClassificationPaths(detailPathsFromAssignments(rows))'));
  assert.ok(detail.includes("groupedClassificationValue(classificationPaths, 'jenisPengadaan')"));
  assert.ok(detail.includes("groupedClassificationValue(classificationPaths, 'jenisPekerjaan')"));
  // Assignment writes must remain on the existing official API, not a second
  // local metadata field or another classification persistence engine.
  assert.ok(panel.includes('await load();'));
  assert.ok(!panel.includes('PATCH /ahsp'));
});

test('classification and parent metadata are different save doors than recipe version', () => {
  assert.ok(panel.includes("method: 'POST'"));
  assert.ok(detail.includes('Simpan Informasi Dasar'));
  assert.ok(detail.includes('Simpan Perubahan Komponen'));
  assert.ok(detail.includes('Informasi Dasar dan Klasifikasi disimpan melalui tombol masing-masing.'));
});

test('vocabulary-only options enable classification save via pendingPaths, no duplicate engine', () => {
  assert.ok(panel.includes('const pendingPaths = draft.pendingPaths ?? []'));
  assert.ok(panel.includes('leafNodeIds.length === 0 && pendingPaths.length === 0'));
  assert.ok(panel.includes('jenisPengadaanRootId: draft.jenisPengadaanRootId'));
  assert.ok(panel.includes('pendingPaths,'));
  assert.ok(panel.includes('disabled={busy || (draft.paths.length === 0 && (draft.pendingPaths?.length ?? 0) === 0)}'));
  assert.ok(panel.includes('const verified = await load()'));
  assert.ok(panel.includes('verifiedPending'));
  assert.ok(panel.includes('verifiedPersisted'));
  assert.ok(panel.includes('onSaved?.()'));
});

test('red errors and green success are not mixed; stale red clears after verified success', () => {
  assert.ok(detail.includes('const [actionSuccess, setActionSuccess]'));
  assert.ok(detail.includes("setActionSuccess('Perubahan berhasil disimpan.')"));
  assert.ok(detail.includes("setActionSuccess('Perubahan klasifikasi berhasil disimpan.')"));
  assert.ok(detail.includes("setActionSuccess('Perubahan Komponen berhasil disimpan.')"));
  assert.ok(detail.includes("color: '#16803C'"));
  assert.ok(detail.includes("color: '#C0392B'"));
  assert.ok(detail.includes('setActionError(null);\n      setActionSuccess(\'Perubahan berhasil disimpan.\')'));
  assert.ok(detail.includes("role={metadataFeedback === 'Informasi Dasar tersimpan dan sesuai dengan data AHSP.' ? 'status' : 'alert'}"));
  assert.ok(panel.includes('onSaveAttempt?.()'));
  assert.ok(!panel.includes("setError('Pilihan klasifikasi berhasil disimpan.')"));
});

test('verified save success expires after five seconds without hiding errors or a newer result', () => {
  assert.ok(detail.includes('if (!actionSuccess) return;'));
  assert.ok(detail.includes('window.setTimeout(() => setActionSuccess(null), 5000)'));
  assert.ok(detail.includes('return () => window.clearTimeout(timeoutId)'));
  assert.ok(detail.includes('}, [actionSuccess]);'));
  assert.ok(!detail.includes('window.setTimeout(() => setActionError(null)'));
});

test('classification cancel is a neutral notice, not a red save failure', () => {
  assert.ok(panel.includes('setDraft(emptyAssistedContext());'));
  assert.ok(panel.includes('setEditorOpen(false);'));
  assert.ok(panel.includes('onCancelled?.();'));
  assert.ok(!panel.includes("setError('Penambahan klasifikasi dibatalkan.')"));
  assert.ok(detail.includes('onCancelled={onClassificationCancelled}'));
  assert.ok(detail.includes("setActionNotice('Penambahan klasifikasi dibatalkan.')"));
  assert.ok(panel.includes('role="alert" className="ahsp-line ahsp-line--error"'));
});

test('removing classification requires explicit confirmation bound to the selected AHSP and assignment', () => {
  assert.ok(panel.includes('const [pendingRemoval, setPendingRemoval]'));
  assert.ok(panel.includes('pendingRemoval?.ahspId === ahspId'));
  assert.ok(panel.includes("row.id === pendingRemoval.assignmentId && row.provenance === 'HUMAN_ADDED' && row.isActive"));
  assert.ok(panel.includes('role="group" aria-label="Konfirmasi hapus pilihan klasifikasi"'));
  assert.ok(panel.includes("pendingRemovalRow.path.map((node) => node.name).join(' › ')"));
  assert.ok(panel.includes('onClick={() => { setPendingRemoval({ ahspId, assignmentId: assignment.id }); setError(null); }}'));
  assert.ok(panel.includes('onClick={() => setPendingRemoval(null)}>Batal</button>'));
  assert.ok(panel.includes('onClick={() => void deactivate(pendingRemovalRow.id)}'));
  assert.ok(!panel.includes('onClick={() => void deactivate(assignment.id)}'));
  assert.ok(panel.includes('setPendingRemoval(null);'));
  // Existing POST writer and its server read-back must remain the only mutation route.
  const removal = panel.slice(panel.indexOf('const deactivate = async'), panel.indexOf('const addSelected = async'));
  assert.ok(removal.includes("{ method: 'POST' }"));
  assert.ok(removal.includes('const verified = await load()'));
  assert.ok(removal.includes('onSaveAttempt?.()'));
});

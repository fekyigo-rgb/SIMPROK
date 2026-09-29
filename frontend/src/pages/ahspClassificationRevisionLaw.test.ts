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

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const routes = readFileSync('src/App.tsx', 'utf8');
const workspace = readFileSync('src/pages/RabWorkspacePage.tsx', 'utf8');
const preparation = readFileSync('src/pages/ProjectSetupPage.tsx', 'utf8');

test('saved RAB has one canonical Preparation route behind Project permissions', () => {
  assert.match(routes, /project\/:projectId\/rab\/preparation/);
  assert.match(routes, /permission="PROJECT_VIEW"><ProjectSetupPage/);
  assert.match(routes, /project\/:projectId\/rab\/workspace/);
});

test('RAB-37: saved Preparation can be READ by PROJECT_VIEW without PROJECT_CREATE; edits stay gated', () => {
  assert.match(preparation, /hasPermission\('PROJECT_CREATE'\)/);
  assert.match(preparation, /rabLifecycle\?\.canEditDraft === true/);
  assert.match(preparation, /!contextEditable \|\| !changed/);
});

test('saved RAB navigation targets its own project and reuses unsaved blocker', () => {
  assert.match(workspace, /navigate\(\x60\/project\/\$\{projectId\}\/rab\/preparation\x60\)/);
  assert.match(workspace, /const blocker = useBlocker/);
  assert.match(workspace, /draftDirty, saving: isSaving/);
  assert.match(workspace, /isSaving \|\| isPersistBusy/);
});

test('Preparation uses the existing region picker and never creates another project', () => {
  assert.match(preparation, /function SavedRabPreparation/);
  assert.match(preparation, /<ProjectIntakeLocationFields/);
  assert.match(preparation, /expectedLocationRegionIds = initialRegionIds/);
  assert.match(preparation, /apiFetch\(\x60\/projects\/\$\{projectId\}\/intake-context\x60/);
  assert.match(preparation, /method: 'PATCH'/);
  assert.match(preparation, /const verified = await loadContext\(\)/);
  assert.match(preparation, /returnPath = \x60\/project\/\$\{projectId\}\/rab\/workspace\x60/);
  assert.match(preparation, /<LocalProjectSetupPage \/>/);
});

test('saving requires explicit confirmation and declines to reprice frozen occurrences', () => {
  assert.match(preparation, /!changed \|\| !confirmationOpen/);
  assert.match(preparation, /Keputusan occurrence, harga, dan BOQ yang sudah tersimpan tidak dihitung ulang otomatis/);
  assert.match(preparation, /locationRegionIds = selectedLocationRegionIds/);
});

test('saved Preparation retains the same five Owner rooms, using read-only fields where authority is absent', () => {
  const saved = preparation.split('function SavedRabPreparation')[1] || '';
  const labels = [
    'Informasi Proyek',
    'Klasifikasi Resmi',
    'Lokasi Resmi',
    'Alamat Detail',
    'Data Pendukung',
  ];
  let cursor = -1;
  for (const label of labels) {
    const next = saved.indexOf('aria-label="' + label + '"', cursor + 1);
    assert.ok(next > cursor, label);
    cursor = next;
  }
  assert.match(saved, /readDraftPreparationFields\(loaded\.project\.description\)/);
  assert.match(saved, /Tahun Anggaran \/ Tahun Harga/);
  assert.match(saved, /Pemilik \/ Instansi/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const room = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const sharedClassification = readFileSync('src/components/AhspImportAssistedClassificationPanel.tsx', 'utf8');
const backend = readFileSync('../backend/src/ahsp/services/ahsp.service.ts', 'utf8');

test('manual consecutive saves reuse ONE existing server route and keep assisted context', () => {
  assert.equal((manual.match(/apiFetch\('\/ahsp\/manual'/g) ?? []).length, 1);
  assert.ok(manual.includes("const saveMode = explicitSave.current;"));
  assert.ok(manual.includes("if (busy || submitLock.current) return;"));
  assert.ok(manual.includes("if (saveMode === 'another')"));
  assert.ok(manual.includes("navigate('/ahsp/' + created.id)"));
  const success = manual.slice(manual.indexOf('committed = true;'), manual.indexOf('} catch {', manual.indexOf('committed = true;')));
  assert.ok(success.includes('setLastSaved({'));
  assert.ok(success.includes('id: created.id'));
  assert.ok(success.includes('name: uraian'));
  assert.ok(success.includes('manualSaveDisposition(created.disposition)'));
  for (const reset of ["setMethodName('')", "setCode('')", "setKeterangan('')", "setOutputUnit('')", "setLabor([])", "setMaterial([])", "setEquipment([])"]) {
    assert.ok(success.includes(reset), reset);
  }
  assert.ok(!success.includes('setAssisted('), 'the shared classification and references are not reset');
  assert.ok(success.includes('setItemSerial((previous) => previous + 1)'), 'resource editor local state resets too');
});

test('both save actions are honest; success requires a persisted server identifier', () => {
  assert.ok(manual.includes("Simpan & Tambah Lagi"));
  assert.ok(manual.includes("Simpan & Lihat Detail"));
  assert.ok(manual.includes("explicitSave.current = 'another'"));
  assert.ok(manual.includes("explicitSave.current = 'detail'"));
  assert.ok(manual.includes("if (!response.ok)"));
  assert.ok(manual.includes("typeof created.id !== 'string'"));
  assert.ok(manual.includes('role="status"'));
  assert.ok(manual.includes("to={'/ahsp/' + lastSaved.id}"));
});

test('AHSP Explorer displays the authoritative unit symbol without changing stored outputUnit', () => {
  assert.ok(backend.includes('outputUnitDefinition: { select: { code: true, symbol: true } }'));
  assert.ok(room.includes('presentedAhspOutputUnitSymbol({ stored: row.versions?.[0]?.outputUnit'));
  assert.ok(room.includes('code: row.versions?.[0]?.outputUnitDefinition?.code'));
  assert.ok(room.includes("r.versions?.[0]?.outputUnit ?? ''"), 'export keeps original source value');
  assert.ok(!room.includes('normalizeUnitAlias'), 'no second unit resolver in Explorer');
});

test('Lingkup Pekerjaan is presentation only: shared classification keys remain canonical', () => {
  assert.ok(sharedClassification.includes('label="Lingkup Pekerjaan"'));
  assert.ok(room.includes("sortButton('WORK_TYPE', 'Lingkup Pekerjaan')"));
  assert.ok(detail.includes("infoRow('Lingkup Pekerjaan'"));
  assert.ok(manual.includes('assisted.paths.map((p) => p.leafNodeId)'));
  assert.ok(sharedClassification.includes('jenisPekerjaan'));
});

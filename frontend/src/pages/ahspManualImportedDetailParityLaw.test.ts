import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const room = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');

test('manual save redirects to same canonical detail route as Daftar AHSP Lihat', () => {
  const save = manual.slice(manual.indexOf('onSubmit={async (event: FormEvent)'), manual.indexOf('</form>', manual.indexOf('onSubmit={async (event: FormEvent)')));
  assert.ok(save.includes("apiFetch('/ahsp/manual'"));
  assert.ok(save.includes("method: 'POST'"));
  assert.ok(save.includes("if (typeof created.id !== 'string' || created.id === '')"));
  assert.ok(save.includes("navigate('/ahsp/' + created.id)"));
  assert.ok(room.includes("<Link to={'/ahsp/' + row.id}"));
  assert.ok(room.includes('<Eye size={14} /> Lihat'));
  assert.ok(app.includes('<Route path="ahsp/manual" element={<PermissionRoute permission="AHSP_MANAGE"><AhspManualPage /></PermissionRoute>} />'));
  assert.ok(app.includes('<Route path="ahsp/:ahspId" element={<PermissionRoute permission="AHSP_VIEW"><AhspDetailPage /></PermissionRoute>} />'));
});

test('manual entry uses the same canonical output fields rather than creating a second result UI', () => {
  const payload = manual.slice(manual.indexOf("const response = await apiFetch('/ahsp/manual'"), manual.indexOf('if (!response.ok)', manual.indexOf("const response = await apiFetch('/ahsp/manual'")));
  for (const field of ['methodName:', 'code:', 'classification:', 'fieldCategory:', 'subCategory:', 'outputUnit:', 'regulationReference:', 'issuerInstitution:', 'resources:', 'leafNodeIds:', 'pendingPaths:']) {
    assert.ok(payload.includes(field), field);
  }
  assert.ok(detail.includes("apiFetch('/ahsp/' + ahspId)"));
  assert.ok(detail.includes('groupAhspDefinitionResources(currentVersion?.resources)'));
  for (const field of ['Informasi AHSP', 'Komponen Pembentuk AHSP', "'Jenis Pengadaan'", "'Kategori'", "'Subkategori'", "'Lingkup Pekerjaan'", "'Dasar AHSP'", "'Penerbit'", "'Tanggal berlaku versi'"]) {
    assert.ok(detail.includes(field), field);
  }
  assert.ok(detail.includes("ahsp.workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya'"));
});

test('manual creation and imported AHSP share one detail component; no per-origin layout fork', () => {
  assert.equal((app.match(/path="ahsp\/:ahspId"/g) ?? []).length, 1);
  const detailView = detail.slice(detail.indexOf('export function AhspDetailPage()'));
  assert.ok(!detailView.includes("if (ahsp.source === 'MANUAL')"));
  assert.ok(!detailView.includes("if (ahsp.source === 'EXCEL')"));
  assert.ok(!detailView.includes("if (ahsp.source === 'IMPORT')"));
  assert.ok(!manual.includes('AhspManualResultPage'));
  assert.ok(!app.includes('<AhspManualResultPage'));
});

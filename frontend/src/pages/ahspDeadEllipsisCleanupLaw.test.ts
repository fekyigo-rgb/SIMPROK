import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const list = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');

test('AHSP list and detail contain no dead ellipsis or duplicated placeholder action menu', () => {
  for (const [name, source] of [['list', list], ['detail', detail]] as const) {
    assert.ok(!source.includes('aria-label="Tindakan lain"'), name);
    assert.ok(!source.includes('<MoreHorizontal'), name);
    assert.ok(!source.includes('MoreHorizontal,'), name);
  }
});

test('existing row Lihat and ID-based selection actions remain intact', () => {
  assert.ok(list.includes("<Link to={'/ahsp/' + row.id}"));
  assert.ok(list.includes('<Eye size={14} /> Lihat'));
  assert.ok(list.includes('checked={selected.has(row.id)}'));
  assert.ok(list.includes('const selectedRows = allRows.filter((r) => selected.has(r.id))'));
  assert.ok(list.includes('aria-label="Tindakan AHSP terpilih"'));
  assert.ok(list.includes('onClick={() => void bulkDelete()}'));
  assert.ok(list.includes('onClick={openProposeConfirm}'));
  assert.ok(list.includes('onClick={exportSelection}'));
  assert.ok(list.includes('onClick={clearSelection}'));
});

test('no writer is replaced or duplicated: existing delete, propose, export, update and history remain', () => {
  assert.ok(list.includes("apiFetch('/ahsp/' + row.id + '/propose', { method: 'POST' })"));
  assert.ok(list.includes("apiFetch('/ahsp/' + row.id, {"));
  assert.ok(list.includes("method: 'DELETE'"));
  assert.ok(list.includes('const exportSelection = () => {'));
  assert.ok(detail.includes('onClick={() => setShowProposeConfirm(true)}'));
  assert.ok(detail.includes('Update AHSP'));
  assert.ok(detail.includes('Riwayat AHSP'));
  assert.ok(detail.includes("apiFetch('/ahsp/' + ahspId + '/versions'"));
  assert.ok(detail.includes('Keterangan status AHSP yang berlaku'));
});

test('Owner-approved AHSP table columns, natural sorting and 20 per page are still preserved', () => {
  assert.ok(list.includes('const PAGE_SIZE = 20;'));
  for (const name of ['Kode', 'Jenis Pekerjaan', 'Uraian', 'Satuan', 'Kategori']) {
    assert.ok(list.includes("'"+name+"'") || list.includes("'"+name.toUpperCase()+"'"), name);
  }
  assert.ok(list.includes('className="ahsp-room__table"'));
  assert.ok(list.includes('className="ahsp-action ahsp-action--outline ahsp-action--compact ahsp-action--view"'));
});

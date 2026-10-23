import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const room = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('off-page scope is computed from ALL persisted row selections, minus current page', () => {
  assert.ok(room.includes('const selectedRows = allRows.filter((r) => selected.has(r.id))'));
  assert.ok(room.includes('const selectedOnPageCount = pageRows.filter((r) => selected.has(r.id)).length;'));
  assert.ok(room.includes('const selectedOutsidePageCount = Math.max(0, selectedRows.length - selectedOnPageCount);'));

  const allRows = Array.from({ length: 71 }, (_, i) => ({ id: String(i + 1) }));
  const pageRows = allRows.slice(20, 40);
  const selected = new Set(['3', '21', '30', '56']);
  const selectedRows = allRows.filter((row) => selected.has(row.id));
  const selectedOnPageCount = pageRows.filter((row) => selected.has(row.id)).length;
  assert.equal(selectedRows.length, 4);
  assert.equal(selectedOnPageCount, 2);
  assert.equal(Math.max(0, selectedRows.length - selectedOnPageCount), 2);
  assert.equal(selected.size, 4, 'changing the displayed page does not clear saved selections');
});

test('off-page explanation appears only when another selected record is not on current page', () => {
  assert.ok(room.includes('{selectedOutsidePageCount > 0 ? ('));
  assert.ok(room.includes('role="note" className="ahsp-room__selection-scope"'));
  assert.ok(room.includes('{selectedOutsidePageCount} pilihan berada di luar halaman ini.'));
  assert.ok(room.includes('{selectedOutsidePageCount} pilihan berada di luar halaman ini. Hapus, Usulkan, dan Export berlaku untuk semua AHSP terpilih.'));
  assert.ok(!room.includes('Hapus dan Export mencakup semua'));
  assert.ok(room.includes('const proposableCount = selectedRows.filter((r) => canProposeAhsp(r)).length;'));
  assert.ok(!room.includes('Hapus, Usulkan, dan Export berlaku untuk semua {selectedRows.length} AHSP terpilih.'));
  assert.ok(room.includes('className="ahsp-room__selection-summary"'));
  assert.ok(css.includes('.ahsp-room__selection-summary {'));
  assert.ok(css.includes('.ahsp-room__selection-scope {'));
  assert.ok(css.includes('max-width: 38rem;'));
});

test('delete confirmation discloses the off-page count before requesting a reason', () => {
  const del = room.slice(room.indexOf('const bulkDelete = async () => {'), room.indexOf('const exportSelection = () => {'));
  assert.ok(del.includes('const outsideNote = selectedOutsidePageCount > 0'));
  assert.ok(del.includes('Termasuk ${selectedOutsidePageCount} AHSP yang tidak terlihat pada halaman ini.'));
  assert.ok(del.includes('window.prompt(`Hapus ${selectedRows.length} AHSP terpilih?${outsideNote} Tuliskan alasan penghapusan:`)'));
  assert.ok(del.includes("if (reason == null || reason.trim() === '') return;"));
  assert.ok(del.includes("method: 'DELETE'"), 'existing writer unchanged');
});

test('existing selection, filters, sorting, 20 rows, and bulk writers are unchanged', () => {
  assert.ok(room.includes('const [selected, setSelected] = useState<Set<string>>(new Set())'));
  assert.ok(room.includes('const toggleSelectPage = () => {'));
  assert.ok(room.includes('const clearSelection = () => setSelected(new Set());'));
  assert.ok(room.includes('const PAGE_SIZE = 20;'));
  assert.ok(room.includes('const sortedRows = useMemo(() => {'));
  assert.ok(room.includes('const visibleRows = useMemo(() => {'));
  assert.ok(room.includes('const [draftQuery, setDraftQuery] = useState(\'\');'));
  assert.ok(room.includes('const [query, setQuery] = useState(\'\');'));
  assert.ok(room.includes('const exportSelection = () => {'));
  assert.ok(room.includes('const bulkPropose = async () => {'));
  assert.ok(room.includes("apiFetch('/ahsp/' + row.id + '/propose', { method: 'POST' })"));
  assert.ok(room.includes("apiFetch('/ahsp/' + row.id, {"));
  assert.ok(room.includes('<Eye size={14} /> Lihat'));
  assert.match(css, /\.ahsp-room__table th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);[^}]*color:\s*var\(--simprok-white\);/s);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view\s*\{[^}]*background:\s*#8b5cf6;/s);
});

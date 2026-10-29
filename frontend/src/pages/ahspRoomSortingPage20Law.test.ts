import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sortAhspListRows } from '../utils/ahspListSort.ts';

const room = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('natural code ordering is numeric, reversible and does not mutate the API array', () => {
  const records = [
    { id: 'a', code: 'B.20' }, { id: 'b', code: 'B.9' },
    { id: 'c', code: '2.3.(5c)' }, { id: 'd', code: 'B.18' }, { id: 'e', code: 'B.2' },
  ];
  const before = records.map(r => r.id);
  const asc = sortAhspListRows(records, r => r.code, 'asc');
  const desc = sortAhspListRows(records, r => r.code, 'desc');
  assert.deepEqual(asc.map(r => r.code), ['2.3.(5c)', 'B.2', 'B.9', 'B.18', 'B.20']);
  assert.deepEqual(desc.map(r => r.code), [...asc.map(r => r.code)].reverse());
  assert.deepEqual(records.map(r => r.id), before, 'original server response remains untouched');
});

test('empty fields remain last in both orders; identical labels preserve input order', () => {
  const records = [
    { id: 'missing', value: null },
    { id: 'first', value: 'Pasir' },
    { id: 'second', value: 'pasir' },
    { id: 'other', value: 'Beton' },
    { id: 'blank', value: '  ' },
  ];
  const asc = sortAhspListRows(records, r => r.value, 'asc').map(r => r.id);
  const desc = sortAhspListRows(records, r => r.value, 'desc').map(r => r.id);
  assert.deepEqual(asc, ['other', 'first', 'second', 'missing', 'blank']);
  assert.deepEqual(desc, ['first', 'second', 'other', 'missing', 'blank']);
});

test('Owner 20 AHSP per page: 71 records become 4 pages and the correct visible ranges', () => {
  assert.match(room, /const PAGE_SIZE = 20;/);
  const data = Array.from({ length: 71 }, (_, i) => ({ id: String(i + 1), code: `B.${i + 1}` }));
  const sorted = sortAhspListRows(data, r => r.code, 'asc');
  const size = 20;
  assert.equal(Math.ceil(sorted.length / size), 4);
  const windows = Array.from({ length: 4 }, (_, page) => {
    const list = sorted.slice(page * size, (page + 1) * size);
    const from = page * size + 1;
    const to = page * size + list.length;
    return [from, to, list.length];
  });
  assert.deepEqual(windows, [[1, 20, 20], [21, 40, 20], [41, 60, 20], [61, 71, 11]]);
  assert.ok(room.includes('Menampilkan {rangeStart} - {rangeEnd} dari {visibleRows.length} data'));
  assert.ok(room.includes('const pageRows = sortedRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)'));
});

test('sort filters first, then sorts matching records, then paginates; selection stays ID-based', () => {
  const f = room.indexOf('const visibleRows = useMemo(');
  const s = room.indexOf('const sortedRows = useMemo(');
  const p = room.indexOf('const pageRows = sortedRows.slice(');
  assert.ok(f >= 0 && f < s && s < p);
  assert.ok(room.includes('if (!sort) return visibleRows;'), 'no implicit default reordering');
  assert.ok(room.includes('sortAhspListRows(visibleRows, (row) => {'));
  assert.ok(room.includes('const [selected, setSelected] = useState<Set<string>>(new Set())'));
  assert.ok(room.includes('const selectedRows = allRows.filter((r) => selected.has(r.id))'));
  assert.ok(room.includes('const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))'));
  assert.ok(room.includes('if (selected.has(id))') === false);
  assert.ok(room.includes('const toggleSort = (key: AhspListSortKey) => {'));
  assert.ok(room.includes('setPage(0);'), 'restart pagination when sort changes');
  assert.ok(!room.includes('apiFetch(\'/ahsp?sort='), 'no new API sort endpoint');
});

test('all five displayed values are sortable with an active arrow, aria-sort and keyboard buttons', () => {
  const header = room.slice(room.indexOf('<thead>'), room.indexOf('</thead>'));
  for (const [key, title] of [
    ['CODE', 'Kode'], ['WORK_TYPE', 'Lingkup Pekerjaan'],
    ['DESCRIPTION', 'Uraian'], ['UNIT', 'Satuan'], ['CATEGORY', 'Kategori'],
  ]) {
    assert.ok(header.includes(`<th aria-sort={headerSort('${key}')}>{sortButton('${key}', '${title}')}</th>`));
    assert.ok(room.includes(`case '${key}': return`) || room.includes(`case '${key}': return paths`), key);
  }
  assert.ok(room.includes('<button\n      type="button"\n      className="ahsp-action ahsp-action--quiet ahsp-room__sort-button"'));
  assert.ok(room.includes('onClick={() => toggleSort(key)}'));
  assert.ok(room.includes('<ArrowUp size={12} aria-hidden="true" />'));
  assert.ok(room.includes('<ArrowDown size={12} aria-hidden="true" />'));
  assert.ok(room.includes('<ChevronsUpDown size={12} aria-hidden="true" />'));
  assert.ok(room.includes("sort.direction === 'asc' ? 'descending' : 'none'") === false);
});

test('Owner-approved blue table, purple Lihat, search and filter presentation are protected', () => {
  assert.match(css, /\.ahsp-room__table th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);[^}]*color:\s*var\(--simprok-white\);/s);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view\s*\{[^}]*background:\s*#8b5cf6;/s);
  assert.ok(css.includes('.ahsp-room__table th .ahsp-room__sort-button {'));
  assert.ok(css.includes('.ahsp-room__table th .ahsp-room__sort-button:focus-visible {'));
  for (const term of ['Cari AHSP', 'Saring sumber AHSP', 'Saring jenis pengadaan AHSP', 'Saring kategori AHSP', 'Saring subkategori AHSP', 'Saring lingkup pekerjaan AHSP']) {
    assert.ok(room.includes(term), term);
  }
  assert.ok(room.includes("to={'/ahsp/' + row.id}"));
  assert.ok(room.includes('<Eye size={14} /> Lihat'));
});

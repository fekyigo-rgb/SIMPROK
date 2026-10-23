import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const room = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');
const searchForm = room.slice(room.indexOf('<form\n              className="ahsp-search-row"'), room.indexOf('</form>', room.indexOf('<form\n              className="ahsp-search-row"')) + '</form>'.length);

test('typing is draft-only; results use the committed search term, never unsubmitted input', () => {
  assert.ok(room.includes("const [draftQuery, setDraftQuery] = useState('');"));
  assert.ok(room.includes("const [query, setQuery] = useState('');"));
  assert.ok(room.includes("const needle = query.trim().toLowerCase();"));
  assert.ok(!room.includes('const needle = draftQuery.trim()'));
  assert.ok(searchForm.includes('value={draftQuery}'));
  assert.ok(searchForm.includes('onChange={(event) => setDraftQuery(event.target.value)}'));
  assert.ok(!searchForm.includes('onChange={(event) => { setQuery('));
});

test('button Cari and Enter use one native form submit and commit the typed query', () => {
  assert.ok(searchForm.includes('className="ahsp-search-row"'));
  assert.ok(searchForm.includes('role="search"'));
  assert.match(searchForm, /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setQuery\(draftQuery\);\s*setPage\(0\);\s*\}\}/);
  assert.ok(searchForm.includes('<button type="submit" className="ahsp-action ahsp-action--primary">Cari</button>'));
  assert.ok(!searchForm.includes('onKeyDown='), 'native Enter submission; no divergent keyboard writer');
  assert.ok(!searchForm.includes('apiFetch('), 'search is local UI-only');
});

test('Reset Filter clears both draft and applied query alongside existing filters', () => {
  const reset = room.slice(room.indexOf('const resetFilters = () => {'), room.indexOf('const toggleSelect = (id: string)'));
  for (const action of [
    "setDraftQuery('');", "setQuery('');", "setSource('ALL');",
    "setJenisPengadaan('');", "setKategori('');", "setSubkategori('');",
    "setJenis('');", 'setPage(0);',
  ]) assert.ok(reset.includes(action), action);
  assert.ok(searchForm.includes('<button type="button" onClick={resetFilters}'));
});

test('query combines with classification filters before established sort and 20-row pagination', () => {
  const filter = room.indexOf('const visibleRows = useMemo(');
  const sort = room.indexOf('const sortedRows = useMemo(');
  const page = room.indexOf('const pageRows = sortedRows.slice(');
  assert.ok(filter >= 0 && filter < sort && sort < page);
  assert.ok(room.includes('[allRows, query, source, jenisPengadaan, kategori, subkategori, jenis]'));
  assert.ok(room.includes('const PAGE_SIZE = 20;'));
  assert.ok(room.includes('const toggleSort = (key: AhspListSortKey)'));
  assert.ok(room.includes('const selectedRows = allRows.filter((r) => selected.has(r.id))'));
  assert.ok(room.includes('Menampilkan {rangeStart} - {rangeEnd} dari {visibleRows.length} data'));
});

test('no layout, blue-white buttons, white header or purple Lihat regression', () => {
  assert.ok(css.includes('.ahsp-search-row {'));
  assert.ok(searchForm.includes('className="ahsp-search-row__field"'));
  assert.ok(searchForm.includes('className="ahsp-search-row__input"'));
  assert.ok(room.includes('<Link to="/ahsp/manual" className="ahsp-action ahsp-action--primary">'));
  assert.ok(room.includes('navigate(\'/ahsp/import\')'));
  assert.match(css, /\.ahsp-room__table th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);[^}]*color:\s*var\(--simprok-white\);/s);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view\s*\{[^}]*background:\s*#8b5cf6;/s);
  assert.ok(room.includes('<Eye size={14} /> Lihat'));
});

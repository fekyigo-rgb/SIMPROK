import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AhspRoomPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('AHSP library alone uses the locked SIMPROK blue table header and Owner-approved white labels', () => {
  assert.match(page, /className="ahsp-room__table"/);
  assert.match(css, /\.ahsp-room__table th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);[^}]*color:\s*var\(--simprok-white\);/s);
});

test('Owner 21 Oct: all list header labels and sort arrows inherit white on the existing blue', () => {
  const headerRule = css.match(/\.ahsp-room__table th\s*\{([^}]+)\}/)?.[1] ?? '';
  const sortRule = css.match(/\.ahsp-room__table th \.ahsp-room__sort-button\s*\{([^}]+)\}/)?.[1] ?? '';
  const hoverRule = css.match(/\.ahsp-room__table th \.ahsp-room__sort-button:hover,[^{]+\{([^}]+)\}/)?.[1] ?? '';
  assert.match(headerRule, /background:\s*var\(--simprok-trust-blue-500\);/);
  assert.match(headerRule, /color:\s*var\(--simprok-white\);/);
  assert.match(sortRule, /color:\s*inherit;/);
  assert.match(hoverRule, /color:\s*inherit;/);
  assert.ok(page.includes('<th>Aksi</th>'));
  for (const label of ['Kode', 'Jenis Pekerjaan', 'Uraian', 'Satuan', 'Kategori']) {
    assert.ok(page.includes("'" + label + "')"), label);
  }
  assert.ok(page.includes('<ArrowUp size={12} aria-hidden="true" />'));
  assert.ok(page.includes('<ArrowDown size={12} aria-hidden="true" />'));
  assert.ok(page.includes('<ChevronsUpDown size={12} aria-hidden="true" />'));
});

test('Owner 21 Oct: manual and import share ONE primary blue-white button style and behavior', () => {
  assert.match(page, /<Link to="\/ahsp\/manual" className="ahsp-action ahsp-action--primary">\s*Buat AHSP Manual\s*<\/Link>/);
  assert.match(page, /<button type="button" onClick=\{\(\) => navigate\('\/ahsp\/import'\)\} className="ahsp-action ahsp-action--primary">/);
  const primaryRule = css.match(/\.ahsp-action--primary\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(primaryRule, /background:\s*var\(--simprok-trust-blue-500\);/);
  assert.match(primaryRule, /border-color:\s*var\(--simprok-trust-blue-500\);/);
  assert.match(primaryRule, /color:\s*var\(--simprok-white\);/);
  for (const token of [
    '.ahsp-action--primary:hover:not(:disabled)',
    '.ahsp-action:focus-visible',
    '.ahsp-action--primary:active:not(:disabled)',
  ]) assert.ok(css.includes(token), token);
  assert.match(page, /<a href="https:\/\/docs\.simprok\.id\/ahsp"[^>]+className="ahsp-action ahsp-action--outline"/);
  assert.ok(!page.includes('ahsp-room__manual-blue-duplicate'));
});

test('AHSP library cursor and keyboard focus use existing blue, without applying to other modules', () => {
  assert.match(css, /\.ahsp-room__filters \.ahsp-search-row__input:focus,/);
  assert.match(css, /\.ahsp-room__filters \.ahsp-field__control:focus\s*\{/);
  assert.match(css, /caret-color:\s*var\(--simprok-trust-blue-500\);/);
  assert.match(css, /\.ahsp-room__table tbody tr:hover td,/);
  assert.match(css, /\.ahsp-room__table tbody tr:focus-within td/);
  assert.match(css, /\.ahsp-room__table input\[type='checkbox'\]:focus-visible/);
});

test('Lihat has a white eye interior, purple lines, and no outer white badge', () => {
  assert.match(page, /to=\{'\/ahsp\/' \+ row\.id\} className="ahsp-action ahsp-action--outline ahsp-action--compact ahsp-action--view"/);
  assert.match(page, /<Eye size=\{14\} \/> Lihat/);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view\s*\{[^}]*background:\s*#8b5cf6;[^}]*color:\s*var\(--simprok-white\);/s);
  const eyeRule = css.match(/\.ahsp-room__table \.ahsp-action--view svg\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(eyeRule, /width:\s*14px;/);
  assert.match(eyeRule, /height:\s*14px;/);
  assert.match(eyeRule, /padding:\s*0;/);
  assert.match(eyeRule, /border-radius:\s*0;/);
  assert.match(eyeRule, /background:\s*transparent;/);
  assert.match(eyeRule, /fill:\s*var\(--simprok-white\);/);
  assert.match(eyeRule, /color:\s*var\(--simprok-glory-purple-500\);/);
  assert.match(eyeRule, /stroke:\s*currentColor;/);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view:hover:not\(:disabled\)\s*\{[^}]*background:\s*#7c3aed;/);
  assert.match(css, /\.ahsp-room__table \.ahsp-action--view:focus-visible/);
  assert.match(page, /apiFetch\('\/ahsp'\)/);
});

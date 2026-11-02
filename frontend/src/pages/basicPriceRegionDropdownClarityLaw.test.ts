import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const picker = readFileSync(new URL('../components/basic-price/ExplorerRegionFilterSelect.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/basicPrice.css', import.meta.url), 'utf8');
const lookup = readFileSync(new URL('../../../backend/src/basic-price/basic-price-import-lookup.service.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');

test('searching wilayah does not mix special categories with canonical location results', () => {
  assert.match(picker, /\{query\.trim\(\)\.length === 0 \? \(/);
  assert.match(picker, /aria-label="Cakupan wilayah lainnya"/);
  assert.match(picker, /\{query\.trim\(\)\.length > 0 \? \(/);
  assert.match(picker, /Pilih wilayah pada daftar untuk memfilter harga/);
  assert.match(picker, /onSelect\(\{ kind: 'unverified' \}\)/);
  assert.match(picker, /onSelect\(\{ kind: 'general' \}\)/);
});

test('canonical parent is visible in search results when it adds location context', () => {
  assert.match(lookup, /parentName: row\.parent\?\.name \?\? null/);
  assert.match(picker, /region\.parentName && !\(labels\.get\(region\.id\) \?\? region\.name\)\.includes\(region\.parentName\)/);
  assert.match(picker, /\{region\.parentName\}/);
  assert.match(css, /\.bp-room \.bp-region-option__context \{[\s\S]*?display: block/);
  assert.doesNotMatch(picker, /new Region\(|createRegion\(/);
});

test('special scope explanations never join names on the same line', () => {
  assert.match(picker, /<span className="bp-region-option__name">Wilayah belum terverifikasi<\/span>/);
  assert.match(picker, /<span className="bp-region-option__context">Hierarki administrasi belum lengkap<\/span>/);
  assert.match(css, /\.bp-room \.bp-region-option__name,[\s\S]*?display: block/);
});

test('typing remains only a lookup, price table changes only on region choice', () => {
  assert.match(picker, /onSelect\(region\)/);
  assert.match(picker, /onSelect\(null\)/);
  assert.match(page, /<ExplorerRegionFilterSelect/);
  assert.doesNotMatch(page, /Jelajahi wilayah &amp; item/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const chip = readFileSync(new URL('../components/basic-price/FreshnessChip.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../components/basic-price/BasicPriceDetailPanel.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/basicPrice.css', import.meta.url), 'utf8');

test('02B: Terkini reuses Backend priceHistory, bounded to three, without removing correction history', () => {
  assert.match(chip, /detail\.detail\.priceHistory/);
  assert.match(chip, /priceHistory\.entries\.slice\(0, 3\)/);
  assert.match(chip, /Riwayat harga singkat/);
  assert.match(chip, /correctionHistoryRows\(corrections\.entries/);
  assert.match(chip, /priceHistory\.truncated/);
  assert.match(css, /\.bp-pop__panel--freshness\s*\{[^}]*max-height:/s);
});

test('02C: date guidance is hover/focus tooltip, not permanent helper below filter', () => {
  assert.match(page, /className="bp-field bp-field--date bp-date-help"/);
  assert.match(page, /className="bp-date-help__tooltip" role="tooltip"/);
  assert.doesNotMatch(page, /id="bp-f-date-help" className="bp-field__help"/);
  assert.match(css, /\.bp-date-help__trigger:hover ~ \.bp-date-help__tooltip/);
  assert.match(css, /\.bp-date-help \.bp-input:focus ~ \.bp-date-help__tooltip/);
});

test('02D: price, metadata and current label in a proportional responsive row', () => {
  const start = detail.indexOf('className="bp-history__row bp-history__row--events"');
  const section = detail.slice(start, start + 1100);
  assert.ok(section.indexOf('bp-history__price') < section.indexOf('bp-history__meta'));
  assert.ok(section.indexOf('bp-history__meta') < section.indexOf('bp-history__tag'));
  assert.match(css, /\.bp-history__row\.bp-history__row--events\s*\{[^}]*grid-template-columns: max-content minmax\(0, 1fr\) auto;/s);
  assert.match(css, /@media \(max-width: 720px\)/);
});

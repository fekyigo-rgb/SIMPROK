import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahspDetailApproved.css', 'utf8');
const start = detail.indexOf('{historicalVersions.length > 0 ? (');
const end = detail.indexOf('</details>', start);
const history = detail.slice(start, end);

test('riwayat reuses past versions from the existing detail response; no new writer or backend', () => {
  assert.ok(detail.includes('return (state.ahsp.versions ?? []).slice(1)'));
  assert.ok(detail.includes("return (state.ahsp.versions ?? [])[0] ?? null"));
  assert.ok(history.includes('historicalVersions.map((version) => ('));
  assert.ok(history.includes('<tr key={version.id}>'));
  assert.ok(!history.includes('apiFetch('));
  assert.ok(!history.includes('method:'));
  assert.ok(!history.includes('onClick='));
});

test('owner-approved purple history door remains conditional and says only recipe-version history', () => {
  assert.ok(history.includes('<details className="ahsp-detail-action-card ahsp-detail-action-card--history">'));
  assert.ok(history.includes('<summary aria-label="Riwayat AHSP" className="ahsp-detail-action__face">'));
  assert.ok(history.includes('<span className="ahsp-detail-action__title">Riwayat AHSP</span>'));
  assert.ok(history.includes('Lihat versi rumus terdahulu yang tersedia'));
  assert.ok(history.includes('bukan seluruh perubahan Informasi Dasar atau Klasifikasi'));
  assert.ok(!history.includes('Lihat daftar perubahan yang pernah dilakukan'));
});

test('history displays actual version, source, unit, date and status without inventing missing values', () => {
  for (const label of ['Versi', 'Sumber / Peraturan', 'Satuan output', 'Tanggal berlaku', 'Status']) {
    assert.ok(history.includes('<th scope="col">' + label + '</th>'), label);
  }
  assert.ok(history.includes('version.versionNumber != null'));
  assert.ok(history.includes('version.regulationReference'));
  assert.ok(history.includes('presentedUnitLabel({ stored: version.outputUnit'));
  assert.ok(history.includes("version.effectiveDate ? formatIndoDate(version.effectiveDate)"));
  assert.ok(history.includes('historyStatusLabel(version.status)'));
});

test('history table is readable by keyboard and on narrow screens without changing approved purple card', () => {
  assert.ok(history.includes('role="region" aria-label="Tabel riwayat versi rumus AHSP" tabIndex={0}'));
  assert.ok(history.includes('className="ahsp-detail-history__table"'));
  assert.match(css, /\.ahsp-detail-history__scroll\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /\.ahsp-detail-history__scroll:focus-visible\s*\{[^}]*outline:/s);
  assert.ok(css.includes('.ahsp-detail-action-card--history .ahsp-detail-history__content'));
  assert.ok(css.includes('.ahsp-detail-action-card--history {'));
});

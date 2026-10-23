import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const style = readFileSync('src/styles/ahspDetailApproved.css', 'utf8');
const tokens = readFileSync('src/index.css', 'utf8');
const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');

test('mockup: No, Uraian, Satuan, Koefisien headers use exactly the submit-button blue token', () => {
  assert.match(tokens, /--simprok-trust-blue-500:\s*#1da1f2;/i);
  assert.ok(detail.includes('className="ahsp-detail-resource-heading"'));
  assert.equal((detail.match(/className="ahsp-detail-resource-heading"/g) ?? []).length, 1);
  assert.match(style, /\.ahsp-resource-columns \.ahsp-detail-resource-heading th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);[^}]*color:\s*#fff;/s);
  for (const title of ['No.', 'Uraian', 'Satuan', 'Koefisien']) {
    assert.ok(detail.includes('>' + title + '</th>'));
  }
  // No new blue text for the actual ingredient names.
  assert.ok(detail.includes('style={{ padding: \'var(--space-1) var(--space-2)\', borderBottom: HAIRLINE, color: NAVY }}'));
  assert.ok(!manual.includes('ahsp-detail-resource-heading'));
});

test('mockup: main left/right panels use a clearer border only on Detail AHSP', () => {
  assert.match(detail, /aria-label="Komponen Pembentuk AHSP" className="ahsp-detail-primary-card"/);
  assert.match(detail, /aria-label="Informasi AHSP" className="ahsp-detail-primary-card"/);
  assert.match(style, /\.ahsp-detail-primary-card\s*\{[^}]*border:\s*1\.5px solid #a8d7ff;/s);
  assert.ok(detail.includes("import '../styles/ahspDetailApproved.css'"));
});

test('mockup: three green-blue-purple action faces with white words and white icon discs', () => {
  assert.ok(detail.includes('className="ahsp-detail-action-strip"'));
  assert.match(style, /\.ahsp-detail-action-strip\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  for (const kind of ['--valid', '--update', '--history']) {
    assert.ok(style.includes('.ahsp-detail-action-card' + kind));
  }
  assert.ok(style.includes('var(--simprok-trust-blue-500)'));
  assert.match(style, /\.ahsp-detail-action__face\s*\{[^}]*color:\s*#fff;/s);
  assert.match(style, /\.ahsp-detail-action__icon\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*#fff;[^}]*color:\s*var\(--ahsp-action-accent\);/s);
  assert.ok(detail.includes('<BadgeCheck size={22} />'));
  assert.ok(detail.includes('<Pencil size={22} />'));
  assert.ok(detail.includes('<History size={22} />'));
});

test('preserve honest validity: no recipe or inactive never claims green active', () => {
  assert.ok(detail.includes('currentVersion && !outOfForce'));
  assert.ok(detail.includes('ahsp-detail-action-card--neutral'));
  assert.ok(detail.includes('aria-label="AHSP belum memiliki rumus"'));
  assert.ok(detail.includes('aria-label="AHSP tidak berlaku"'));
  assert.ok(detail.includes('AHSP yang saat ini digunakan SIMPROK.'));
});

test('hover, keyboard focus, reduced-motion and collapse interaction remain protected', () => {
  assert.ok(detail.includes('<details className="ahsp-detail-action-card ahsp-detail-action-card--update">'));
  assert.ok(detail.includes('<details className="ahsp-detail-action-card ahsp-detail-action-card--history">'));
  assert.match(detail, /<summary aria-label="Riwayat AHSP" className="ahsp-detail-action__face">/);
  assert.ok(detail.includes('<ChevronRight className="ahsp-detail-action__arrow"'));
  assert.ok(detail.includes('aria-label="Update AHSP" onSubmit={addVersion}'));
  assert.ok(detail.includes('historicalVersions.map('));
  assert.match(style, /\.ahsp-detail-action-card:hover,[\s\S]*?focus-within/);
  assert.ok(style.includes('summary:focus-visible'));
  assert.ok(style.includes('.ahsp-detail-action-card[open]'));
  assert.ok(style.includes('@media (max-width: 920px)'));
  assert.ok(style.includes('@media (prefers-reduced-motion: reduce)'));
  // This status card is informational, not a fake button.
  assert.ok(detail.includes('aria-label="AHSP yang berlaku"'));
  assert.ok(!detail.includes('<button aria-label="AHSP yang berlaku"'));
});

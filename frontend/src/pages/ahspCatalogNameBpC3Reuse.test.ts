import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ahsp = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const door = readFileSync('src/components/ahsp/CatalogNameReviewDoor.tsx', 'utf8');
const bp = readFileSync('src/components/basic-price/BasicPriceDetailPanel.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceExplorer.ts', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('AHSP reuses the exact BP-C3 preview and writer APIs instead of creating a second catalog authority', () => {
  for (const token of ['previewCatalogNameImpact', 'correctActiveResourceCatalogName']) {
    assert.ok(door.includes(token));
    assert.ok(bp.includes(token));
    assert.ok(api.includes(token));
  }
  assert.match(door, /from '..\/..\/api\/basicPriceExplorer'/);
  assert.match(door, /expectedUpdatedAt: result\.observedVersion/);
  assert.match(door, /sameIdentityConfirmed: true/);
  assert.match(door, /reason: reason\.trim\(\)/);
  assert.match(door, /evidence: evidence\.trim\(\)/);
});

test('four-condition handling never confuses source spelling with existing catalog identity', () => {
  assert.match(ahsp, /<ObservedNameReviewPanel/);
  assert.match(ahsp, /<CatalogNameReviewDoor/);
  assert.match(ahsp, /resourceCatalogId=\{choice\.resourceCatalogId\}/);
  assert.match(ahsp, /resourceName=\{choice\.name\}/);
  assert.match(ahsp, /onClick=\{\(\) => void curateExisting\(group, at, choice, remember\)\}/);
  assert.match(door, /Ini bukan koreksi nama Excel dan bukan keputusan padanan/);
  assert.match(door, /Resource ID tidak diganti/);
  assert.match(css, /\.ahsp-catalog-name-door/);
});

test('preview and correction are permission-scoped, explicitly chosen and fail closed for non-private catalog', () => {
  assert.match(door, /hasPermission\('BASIC_PRICE_VIEW'\)/);
  assert.match(door, /hasPermission\('AHSP_RESOURCE_IDENTITY_DECIDE'\)/);
  assert.match(door, /if \(busy \|\| !canPreview \|\| proposal\.trim\(\)\.length < 3\) return/);
  assert.match(door, /canCorrect && writableVerdict && verified/);
  assert.match(door, /nomenclatureVerified && sourceReference\.trim\(\)\.length >= 12 && codeCorrect/);
  assert.match(door, /resourceCatalogId, result\.proposedName/);
  assert.match(door, /readback\.verdict !== 'NO_CHANGE'/);
  assert.match(door, /setError\('Permintaan diterima, tetapi nama baru belum terbukti/);
  assert.match(door, /tidak dapat diperiksa untuk resource ini/);
});

test('identity collisions and technical changes never unlock correction', () => {
  assert.match(door, /result\?\.verdict === 'SPELLING_ONLY_PREVIEW'/);
  assert.match(door, /result\?\.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED'/);
  assert.match(door, /IDENTITY_CONFLICT_REVIEW_REQUIRED/);
  assert.match(door, /Ada benturan dengan identitas lain/);
  assert.match(door, /Perubahan mungkin mengubah identitas atau spesifikasi/);
  assert.match(door, /jangan membuat resource duplikat/);
});

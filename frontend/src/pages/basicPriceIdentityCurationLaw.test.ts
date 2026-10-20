import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceImport.ts', 'utf8');
const controller = readFileSync('../backend/src/basic-price/basic-price-import.controller.ts', 'utf8');
const bridge = readFileSync('../backend/src/basic-price/basic-price-identity-review-bridge.service.ts', 'utf8');
const moduleCode = readFileSync('../backend/src/basic-price/basic-price.module.ts', 'utf8');
const shared = readFileSync('../backend/src/resource-catalog/resource-observation.service.ts', 'utf8');
const admission = readFileSync('../backend/src/basic-price/basic-price-row-resolution.service.ts', 'utf8');

test('BP205-PRIVATE-01 private review does not require a new external identity-approval request', () => {
  assert.match(page, /IDENTITY_CANDIDATE_BLOCKED/u);
  assert.match(page, /Pilih Item yang Sesuai Padanan/u);
  assert.match(page, /Tetapkan Item Baru/u);
  assert.doesNotMatch(page, /Ajukan Pemeriksaan Item|handleRequestIdentityReview|requestBasicPriceIdentityReview/u);
  assert.match(page, /Hasil pencarian kosong belum membuktikan bahwa item ini baru/u);
  assert.match(page, /memuat ulang halaman saja tidak membuktikan perbedaan tersebut/u);
});

test('BP205-PRIVATE-02 owner-owned private admission uses shared authoritative minting and source unit proof', () => {
  assert.match(admission, /async admitResourceForRow\(/u);
  assert.match(admission, /admitObservedResource\(tx/u);
  assert.match(admission, /RESOURCE_ADMISSION_REVIEW_STALE/u);
  assert.match(admission, /refusedCandidateIds/u);
  assert.match(admission, /reviewBindingFingerprint/u);
  assert.match(admission, /unitDefinitionId/u);
  assert.match(page, /await admitResourceForImportRow\(/u);
});

test('BP205-PRIVATE-03 historical observations remain retrievable and never write prices themselves', () => {
  assert.match(moduleCode, /BasicPriceIdentityReviewBridgeService/u);
  assert.match(moduleCode, /ResourceCatalogModule/u);
  assert.match(bridge, /async statuses\(/u);
  assert.match(bridge, /observedResource\.findMany/u);
  assert.match(bridge, /assertBatchOwnedByCaller/u);
  assert.match(api, /getBasicPriceIdentityReviews/u);
  assert.match(controller, /@Get\(':batchId\/identity-reviews'\)/u);
  assert.match(page, /await getBasicPriceIdentityReviews\(batchId\)/u);
  assert.match(page, /Riwayat: identitas pernah diputuskan/u);
  assert.match(page, /Harga tidak otomatis disimpan/u);
});

test('BP205-PRIVATE-04 no second catalog engine or loss of existing observed-resource evidence', () => {
  assert.match(bridge, /this\.observations\.observeMany/u);
  assert.match(bridge, /origin: 'BASIC_PRICE'/u);
  assert.match(shared, /async observeMany/u);
  assert.doesNotMatch(bridge, /resourceCatalog\.create|resourceCatalog\.upsert/u);
});

test('BP205-PRIVATE-05 pre-existing request API retained for audit compatibility, not as mandatory UI', () => {
  assert.match(controller, /@Post\(':batchId\/rows\/:rowId\/request-identity-review'\)/u);
  assert.match(bridge, /CATEGORY_CONFIRMATION_REQUIRED/u);
  assert.match(bridge, /ROW_VERSION_STALE/u);
  assert.match(bridge, /IDENTITY_CANDIDATE_BLOCKED/u);
  assert.doesNotMatch(page, /requestBasicPriceIdentityReview\(/u);
});

test('BP205-PRIVATE-06 no private price auto-publishing through identity review', () => {
  assert.match(page, /Item privat tidak memerlukan persetujuan katalog resmi SIMPROK/u);
  assert.match(page, /Simpan &amp; Gunakan/u);
  assert.match(page, /Persetujuan pihak lain bukan syarat pemakaian item privat/u);
});

test('BP205-CALM-01 blocked private identity shows one short result, with candidates disclosed on demand', () => {
  assert.match(page, /<div className="bp-field__help">\s*<p role="status">\{row.machineProposal\?\.blockingFacts.includes\('SOURCE_SPECIFICATION_UNVERIFIED'\)/u);
  assert.match(page, /Spesifikasi dari berkas belum diperiksa\. Item ini belum bisa disimpan atau dinyatakan identik\./u);
  assert.match(page, /<details className="bp-details">\s*<summary>Bandingkan kandidat dan bukti identitas<\/summary>/u);
  assert.match(page, /bukti yang masih diperlukan:/u);
  assert.doesNotMatch(page, /Jika item itu berbeda, perbaiki nama atau kode sumber/u);
  assert.match(page, /Nama kerja bukan bukti spesifikasi/u);
});

test('BP205-CALM-02 old identity decisions remain accessible without competing with the current action', () => {
  assert.match(page, /<details className="bp-details" aria-label=\{`Riwayat identitas baris/u);
  assert.match(page, /<summary>Riwayat keputusan identitas<\/summary>/u);
  assert.match(page, /Riwayat: identitas pernah diputuskan/u);
  assert.doesNotMatch(page, /<div className="bp-note bp-note--info" role="status" aria-label=\{`Riwayat identitas/u);
});

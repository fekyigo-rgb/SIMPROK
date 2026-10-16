import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceImport.ts', 'utf8');
const controller = readFileSync('../backend/src/basic-price/basic-price-import.controller.ts', 'utf8');
const bridge = readFileSync('../backend/src/basic-price/basic-price-identity-review-bridge.service.ts', 'utf8');
const module = readFileSync('../backend/src/basic-price/basic-price.module.ts', 'utf8');
const shared = readFileSync('../backend/src/resource-catalog/resource-observation.service.ts', 'utf8');

test('BP205-OBS-01 blocked item has an actionable governed review request without direct admission', () => {
  assert.match(page, /IDENTITY_CANDIDATE_BLOCKED/u);
  assert.match(page, /Minta Pemeriksaan Identitas/u);
  assert.match(page, /handleRequestIdentityReview\(row\)/u);
  assert.match(page, /await requestBasicPriceIdentityReview\(batchId, row\.id, row\.version\)/u);
  assert.match(api, /\/rows\/\$\{rowId\}\/request-identity-review/u);
  assert.match(page, /Item baru belum disimpan/u);
});

test('BP205-OBS-02 raw category guess must be confirmed before curation', () => {
  assert.match(page, /ROW_CATEGORY_CONFIRMED_BY_REVIEWER/u);
  assert.match(page, /Kategori awal berkas belum cukup/u);
  assert.match(bridge, /CATEGORY_CONFIRMATION_REQUIRED/u);
  assert.match(bridge, /ROW_VERSION_STALE/u);
  assert.match(bridge, /IDENTITY_CANDIDATE_BLOCKED/u);
});

test('BP205-OBS-03 source-proven candidate review uses ONE existing lifecycle', () => {
  assert.match(module, /ResourceCatalogModule/u);
  assert.match(bridge, /this\.observations\.observeMany/u);
  assert.match(bridge, /origin: 'BASIC_PRICE'/u);
  assert.match(shared, /async observeMany/u);
  assert.doesNotMatch(bridge, /resourceCatalog\.create|resourceCatalog\.upsert/u);
  assert.match(controller, /@Permissions\(PERMISSIONS\.BASIC_PRICE_RESOLVE\)/u);
  assert.match(bridge, /assertBatchOwnedByCaller/u);
});

test('BP205-OBS-05 curator outcome remains visible after an old blocking candidate disappears', () => {
  const decisionBanner = page.indexOf('aria-label={`Hasil pemeriksaan identitas baris');
  const candidatePanel = page.indexOf("!admissionOffered && admissionReview?.reasonCode");
  assert.ok(decisionBanner > 0, 'curator outcome needs its own stable presentation');
  assert.ok(candidatePanel > decisionBanner, 'outcome must not depend on old candidate blockade');
  assert.match(page, /admissionReview\?\.reasonCode !== 'IDENTITY_CANDIDATE_BLOCKED'/u);
  assert.match(page, /Identitas telah diputuskan pengelola/u);
  assert.match(page, /Minta pengelola menuntaskan aksesnya/u);
  assert.match(page, /Item baru belum disimpan/u);
});

test('BP205-OBS-04 one scoped status read, honest display after reloading', () => {
  assert.match(api, /getBasicPriceIdentityReviews/u);
  assert.match(page, /await getBasicPriceIdentityReviews\(batchId\)/u);
  assert.match(page, /setIdentityReviewStatuses\(null\)/u);
  assert.match(page, /menunggu keputusan pengelola/u);
  assert.match(page, /Pengelola telah memutuskan identitas/u);
  assert.match(page, /Status pemeriksaan sebelumnya belum dapat dibaca/u);
  assert.match(bridge, /async statuses\(/u);
  assert.match(bridge, /observedResource\.findMany/u);
});

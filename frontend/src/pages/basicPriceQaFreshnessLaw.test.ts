import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const api = readFileSync('src/api/basicPriceImport.ts', 'utf8');
const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');

test('QA-207 browser review fetch never reuses stale HTTP cache for a mutable batch', () => {
  assert.match(api, /apiFetch\(`\/basic-price-imports\/\$\{batchId\}`,\s*\{\s*cache:\s*'no-store'\s*\}\)/u);
});

test('QA-207 reviewer returning to tab rereads canonical batch without re-deciding or polling', () => {
  assert.match(page, /window\.addEventListener\('focus', onFocus\)/u);
  assert.match(page, /window\.removeEventListener\('focus', onFocus\)/u);
  assert.match(page, /document\.visibilityState === 'visible'\) void loadBatch\(false\)/u);
  assert.match(page, /const result = await getBasicPriceImportBatch\(batchId\);\s*setBatch\(result\)/u);
});

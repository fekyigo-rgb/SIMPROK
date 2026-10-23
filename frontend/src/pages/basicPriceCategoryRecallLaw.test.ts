import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const copy = readFileSync('src/utils/basicPriceImportDisplay.ts', 'utf8');

test('BP category replay suppresses redundant confirmation without inventing a new row decision', () => {
  assert.match(page, /row\.machineProposal\?\.categoryReusedFromPriorReview !== true/u);
  assert.match(page, /row\.machineProposal\?\.categoryReusedFromPriorReview === true && !proven/u);
  assert.match(copy, /row\.machineProposal\?\.categoryReusedFromPriorReview === true\) \{/u);
  assert.match(copy, /Kategori dikenali dari konfirmasi sebelumnya:/u);
  assert.match(copy, /if \(row\.machineProposal\?\.categoryReusedFromPriorReview === true\) continue/u);
});

test('BP category memory is only displayed as category proof, NOT resource identity or price proof', () => {
  assert.match(page, /row\.machineProposal\?\.categoryReusedFromPriorReview === true && !proven/u);
  assert.match(page, /Identitas, ukuran, dan spesifikasi tetap diperiksa sebelum harga disimpan/u);
  assert.match(page, /const proven = row\.machineProposal\?\.identityPairProven === true/u);
  assert.match(page, /Konfirmasi Jenis/u);
});

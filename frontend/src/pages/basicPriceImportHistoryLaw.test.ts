import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const review = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const page = readFileSync('src/pages/BasicPriceImportPage.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceImport.ts', 'utf8');

test('Import history reads the SAME persisted Basic Price batches, not a second draft source', () => {
  assert.match(api, /\/basic-price-imports\/history\?page=/);
  assert.match(api, /cache: 'no-store'/);
  assert.match(page, /Riwayat Impor Basic Price/u);
  assert.match(page, /listBasicPriceImportHistory\(\)/u);
  assert.match(page, /savedPrivateRows/u);
  assert.match(page, /pendingRows/u);
  assert.match(page, /readyToSaveRows/u);
  assert.match(page, /dari \{entry\.totalRows\} baris/u);
});

test('Resume old batch from canonical route; no re-upload is required', () => {
  assert.match(page, /navigate\(`\/basic-price\/import\/\$\{entry\.batchId\}\/review`\)/u);
  assert.match(page, /navigate\(`\/basic-price\/import\/\$\{entry\.batchId\}`\)/u);
  assert.match(page, /Lanjut Pemeriksaan/u);
  assert.match(page, /Periksa Konteks Sumber/u);
  assert.match(page, /tidak perlu unggah ulang/u);
});

test('Partial completion keeps pre-existing row-private-save behaviour', () => {
  assert.match(review, /keepSingleBasicPriceImportRowPrivate/u);
  assert.match(review, /READY_FOR_SUBMISSION/u);
  assert.match(review, /Simpan Privat baris ini saja/u);
  assert.match(page, /Pilihan sementara yang belum dikonfirmasi/u);
});

test('Leaving review verifies the server batch and warns that unconfirmed picker drafts are not persisted', () => {
  assert.match(review, /confirmLeaveWithUncommittedChoices/);
  assert.match(review, /touchedRowIds\.size === 0 \|\| window\.confirm/);
  assert.match(review, /getBasicPriceImportBatch\(batch\.batchId\)/);
  assert.match(review, /BATCH_READBACK_MISMATCH/);
  assert.match(review, /Selesai untuk Sekarang · Riwayat Impor/);
  assert.match(review, /showImportHistory: true/);
  assert.match(page, /open=\{showHistoryFromNav\}/);
  assert.match(review, /Belum dapat memverifikasi batch tersimpan/);
});

test('History never carries previous-workspace results into the newly selected workspace', () => {
  assert.match(page, /const \{ activeWorkspaceId \} = useAuth\(\)/);
  assert.match(page, /setImportHistory\(null\)/);
  assert.match(page, /\[location\.pathname, activeWorkspaceId\]/);
  assert.match(page, /historyScopeRef\.current !== scope/);
  assert.match(page, /historyScopeRef\.current === scope/);
});

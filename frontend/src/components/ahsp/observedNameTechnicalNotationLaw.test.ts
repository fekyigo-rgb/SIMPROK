import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/ahsp/ObservedNameReviewPanel.tsx', 'utf8');

test("Beton fc to f'c is explained as notation correction, not a new technical specification", () => {
  assert.match(panel, /Beton fc 10 Mpa → Beton f'c 10 Mpa/);
  assert.match(panel, /Jangan ubah kode, satuan, kapasitas atau spesifikasi/);
});

test('unchanged names cannot be submitted and user is routed back to resource identity', () => {
  assert.match(panel, /name\.trim\(\) === \(record\.latest\?\.reviewedName \?\? record\.rawName\)/);
  assert.match(panel, /Nama belum diubah\. Koreksi tidak diperlukan/);
  assert.match(panel, /Koreksi tidak diperlukan; silakan lanjutkan/);
});

test('actual backend reason distinguishes no-op and technical mismatch without hiding conflicts', () => {
  assert.match(panel, /response\.status === 400/);
  assert.match(panel, /reasonCode === 'REVIEWED_NAME_UNCHANGED'/);
  assert.match(panel, /reasonCode === 'NAME_REVIEW_NOT_SPELLING_ONLY'/);
  assert.match(panel, /versi atau fakta sumber telah berubah/);
});

test('append event still requires successful durable readback, not optimistic success', () => {
  assert.match(panel, /expectedVersion: record\.currentVersion/);
  assert.match(panel, /sourceFactsFingerprint: record\.sourceFactsFingerprint/);
  assert.match(panel, /persisted\.currentVersion !== record\.currentVersion \+ 1/);
  assert.match(panel, /Identitas belum otomatis ditetapkan/);
});

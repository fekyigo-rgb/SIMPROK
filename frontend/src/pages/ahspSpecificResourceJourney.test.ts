import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const styles = readFileSync('src/styles/ahsp.css', 'utf8');

test('one identity question has an optional disclosure for all spelling corrections, no primary-button flood', () => {
  assert.match(page, /<details className="ahsp-observation-corrections">/);
  assert.match(page, /Perbaiki ejaan sumber pada observasi tertentu \(\{group\.ids\.length\}\) — opsional/);
  assert.match(page, /group\.ids\.map\(\(observationId\) => \(/);
  assert.match(page, /Koreksi ejaan tidak menetapkan identitas/);
  assert.match(styles, /\.ahsp-observation-corrections\[open\]/);
});

test('different source-bound specification offers explicit new-resource review without rewriting match result', () => {
  assert.match(page, /<details className="ahsp-specific-new-review">/);
  assert.match(page, /Padanan di atas berbeda\? Periksa spesifikasi dan tetapkan item baru/);
  assert.match(page, /Teks spesifikasi persis dari nama di dokumen/);
  assert.match(page, /confirmedSpecifications: \{ \[evidence\.attribute\]: evidence\.value \}/);
  assert.match(page, /refusedCandidateIds: evidence\.refusal\.candidateIds/);
  assert.match(page, /candidateContextDigest: evidence\.refusal\.candidateContextDigest/);
  assert.match(page, /sourceDesignation\.toLocaleLowerCase/);
  assert.match(page, /Kernel identitas akan memeriksa lagi seluruh kandidat/);
  assert.match(page, /disabled=\{locked \|\| !evidenceIsVisible \|\| specDraft\.reason\.trim\(\)\.length === 0\}/);
});

test('old safe admission path remains available and unchanged for candidates already exhausted', () => {
  assert.match(page, /group\.view\.newResourceRefusal/);
  assert.match(page, /ids: group\.ids\.slice\(0, 1\)/);
  assert.match(page, /remember: false/);
});

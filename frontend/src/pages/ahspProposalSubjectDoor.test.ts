import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('./AhspDetailPage.tsx', import.meta.url), 'utf8');

test('the review surface reads the proposal subject, not a publication door', () => {
  assert.equal(detail.includes('Data yang diajukan'), true);
  assert.equal(detail.includes("'/ahsp/' + ahspId + '/proposal-subject'"), true);
  assert.equal(detail.includes("'/approve'"), false);
  assert.equal(detail.includes('PLATFORM_KNOWLEDGE'), false);
  assert.equal(detail.includes('pendingPaths'), false);
  assert.equal(detail.includes(".join(' → ')"), true);
});

test('proposal subject reuses the detail unit label and does not invent one', () => {
  assert.equal(detail.includes('stored: subject.outputUnit'), true);
  assert.equal(detail.includes('stored: row.baseUnit'), true);
  assert.equal(detail.includes("(row.resourceName ?? '').trim() || row.resourceId"), true);
  assert.equal(detail.includes('presentedUnitLabel'), true);
  assert.equal(detail.includes('Nama sumber daya belum tersedia'), false);
  assert.equal(detail.includes('Cubic metre'), false);
  assert.equal(detail.includes('Orang-hari'), false);
  assert.equal(detail.includes("baseUnit: 'OH'"), false);
});

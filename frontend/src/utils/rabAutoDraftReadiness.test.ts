import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRabAutoItemReadiness, parseRabAutoDraftPage, summarizeRabAutoDraft } from './rabAutoDraftReadiness.ts';

const projectId = 'project-1';
const line = (boqItemId: string, kind: string) => ({
  boqItemId, kind, mutationPerformed: false as const,
});
const page = (extra: Record<string, unknown> = {}): unknown => ({
  projectId, page: 1, limit: 25, hasNext: false,
  results: [line('a', 'CANDIDATE_REQUIRES_IDENTITY_PROOF')],
  mutationPerformed: false, automaticBindingPerformed: false,
  ...extra,
});

test('reads a governed, read-only project page only for the correct project', () => {
  assert.equal(parseRabAutoDraftPage(page(), projectId, 1)?.results.length, 1);
  assert.equal(parseRabAutoDraftPage(page(), 'other-project', 1), null);
  assert.equal(parseRabAutoDraftPage(page(), projectId, 2), null);
});

test('refuses unauthorized mutation claims, unknown statuses, duplicate IDs, oversized page', () => {
  const bad = [
    { automaticBindingPerformed: true },
    { mutationPerformed: true },
    { limit: 26 },
    { page: 0 },
    { results: [line('a', 'MADE_UP_AUTHORITY')] },
    { results: [line('a', 'NO_ELIGIBLE_AHSP'), line('a', 'ALREADY_LINKED')] },
    { results: [line('a', 'ALREADY_LINKED'), { boqItemId: 'b', kind: 'ALREADY_LINKED', mutationPerformed: true }] },
    { hasNext: 'false' },
  ];
  for (const patch of bad) assert.equal(parseRabAutoDraftPage(page(patch), projectId, 1), null);
});

test('keeps frozen calculation lineage and manual prices distinct from working AHSP links', () => {
  const result = summarizeRabAutoDraft([
    line('frozen', 'PERSISTED_CALCULATION_REPROOF_REQUIRED'),
    line('manual', 'MANUAL_PRICE_PRESERVED'),
    line('linked', 'ALREADY_LINKED'),
    line('damaged', 'INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW'),
  ]);
  assert.equal(result.persisted, 1);
  assert.equal(result.manual, 1);
  assert.equal(result.linked, 1);
  assert.equal(result.other, 1);
  assert.match(result.label, /harga Cost Kernel tersimpan \(jejak perlu pembuktian ulang\)/);
  assert.match(result.label, /Harga tersimpan tidak dihitung sebagai tautan kerja aktif/);
});

test('does not equate candidate recommendations with linked or priced BOQ', () => {
  const result = summarizeRabAutoDraft([
    line('a', 'ALREADY_LINKED'),
    line('b', 'CANDIDATE_REQUIRES_IDENTITY_PROOF'),
    line('c', 'MULTIPLE_RECOMMENDATIONS'),
    line('d', 'NO_ELIGIBLE_AHSP'),
    line('e', 'READINESS_UNAVAILABLE_REQUIRES_REVIEW'),
  ]);
  assert.deepEqual({ checked: result.checked, linked: result.linked,
    noAhsp: result.noAhsp, needsProof: result.needsProof, other: result.other }, {
    checked: 5, linked: 1, noAhsp: 1, needsProof: 2, other: 1,
  });
  assert.match(result.label, /tautan kerja AHSP aktif/);
  assert.match(result.label, /Harga tidak ditentukan dari rekomendasi/);
});

test('RAB-AUTO-08: accepts ONLY an explicit nonbinding unique preview from existing readiness', () => {
  const preview = {
    ahspVersionId: 'version-B25',
    code: 'B.25',
    workType: 'B.25',
    methodName: 'Gorong-gorong Pipa Baja Bergelombang',
    outputUnit: 'm',
    bindingAuthorized: false,
  };
  const valid = page({
    results: [{
      boqItemId: 'boq-B25', kind: 'CANDIDATE_REQUIRES_IDENTITY_PROOF',
      mutationPerformed: false, candidatePreview: preview,
    }],
  });
  const parsed = parseRabAutoDraftPage(valid, projectId, 1);
  assert.deepEqual(parsed?.results[0]?.candidatePreview, preview);
  assert.match(describeRabAutoItemReadiness(parsed?.results[0]) ?? '', /Tinjau kode, uraian, satuan/);
  for (const candidate of [
    { ...preview, bindingAuthorized: true },
    { ...preview, ahspVersionId: '' },
    { ...preview, code: 13 },
    { ...preview, outputUnit: 4 },
  ]) {
    assert.equal(parseRabAutoDraftPage(page({
      results: [{
        boqItemId: 'boq-B25', kind: 'CANDIDATE_REQUIRES_IDENTITY_PROOF',
        mutationPerformed: false, candidatePreview: candidate,
      }],
    }), projectId, 1), null);
  }
  assert.equal(parseRabAutoDraftPage(page({
    results: [{
      boqItemId: 'boq-B25', kind: 'MULTIPLE_RECOMMENDATIONS',
      mutationPerformed: false, candidatePreview: preview,
    }],
  }), projectId, 1), null);
});

test('RAB-AUTO-08: communicates no eligible AHSP, ambiguity, and frozen state distinctly', () => {
  assert.match(describeRabAutoItemReadiness(line('a', 'NO_ELIGIBLE_AHSP')) ?? '', /Belum ada AHSP/);
  assert.match(describeRabAutoItemReadiness(line('b', 'MULTIPLE_RECOMMENDATIONS')) ?? '', /lebih dari satu/);
  assert.match(describeRabAutoItemReadiness(line('c', 'PERSISTED_CALCULATION_REPROOF_REQUIRED')) ?? '', /jangan mengikat ulang/);
  assert.equal(describeRabAutoItemReadiness(null), null);
});

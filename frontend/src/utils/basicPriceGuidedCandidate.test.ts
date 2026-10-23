import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  guidedIdentityCandidates,
  type BasicPriceImportRowSummary,
  type RowResourceCandidate,
} from './basicPriceImportDisplay.ts';

const candidate = (id: string, name: string, prior = false, unproved: string[] = []): RowResourceCandidate => ({
  resourceCatalogId: id, name, code: null, type: 'MATERIAL', baseUnit: 'Kg',
  evidence: ['REVIEWED_MAPPING_NAME_MATCH'],
  specificationUnproved: unproved.length > 0, unprovedSpecificationFacts: unproved,
  hasPriorHumanDecision: prior,
});
const row = (candidates: RowResourceCandidate[], proven = false, status: BasicPriceImportRowSummary['status'] = 'NEEDS_REVIEW') => ({
  status,
  machineProposal: {
    identityPairProven: proven,
    resource: { candidates },
  },
}) as unknown as Pick<BasicPriceImportRowSummary, 'status' | 'machineProposal'>;

test('Semen: show historical decisions first but never rewrite machine ordering or identity', () => {
  const source = [
    candidate('c1', 'Semen Warna'), candidate('c2', 'Semen Portlan', true),
    candidate('c3', 'Semen Portland / Tonasa', true),
    candidate('c4', 'Mortar Instan'),
  ];
  const original = JSON.stringify(source);
  const grouped = guidedIdentityCandidates(row(source));
  assert.deepEqual(grouped.prior.map(c => c.searchKey), ['c2', 'c3']);
  assert.deepEqual(grouped.other.map(c => c.searchKey), ['c1', 'c4']);
  assert.equal(JSON.stringify(source), original);
});

test('Paku khusus: does not force a generic nail candidate, preserves unresolved specification', () => {
  const paku = candidate('special', 'Paku 5-7 cm', true, ['segala Merk']);
  const grouped = guidedIdentityCandidates(row([paku]));
  assert.equal(grouped.prior[0].searchKey, 'special');
  assert.deepEqual(grouped.prior[0].unprovedSpecificationFacts, ['segala Merk']);
  assert.deepEqual(grouped.other, []);
});

test('already proven, rejected and ready rows do not show candidate-review work', () => {
  const candidates = [candidate('a', 'Semen')];
  assert.deepEqual(guidedIdentityCandidates(row(candidates, true)), { prior: [], other: [] });
  assert.deepEqual(guidedIdentityCandidates(row(candidates, false, 'REJECTED')), { prior: [], other: [] });
  assert.deepEqual(guidedIdentityCandidates(row(candidates, false, 'READY_FOR_SUBMISSION')), { prior: [], other: [] });
});

test('duplicate nominated identity is shown once, without manufacturing alternatives', () => {
  const grouped = guidedIdentityCandidates(row([
    candidate('a', 'Semen Portlan', true), candidate('a', 'Semen Portlan', true),
    candidate('b', 'Semen Warna'),
  ]));
  assert.equal(grouped.prior.length + grouped.other.length, 2);
});

test('periksa di katalog uses canonical search control without selecting or persisting catalog ID', () => {
  const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
  assert.match(page, /visibleGuidedCandidates\.map\(renderGuidedCandidate\)/u);
  assert.match(page, /hiddenGuidedOther\.map\(renderGuidedCandidate\)/u);
  assert.match(page, /setCandidateSearchSeeds/u);
  assert.match(page, /initialQuery=\{\(candidateSearchSeeds\[row.id\]\?\.name/u);
  assert.match(page, /Pilih hasil yang benar dan periksa satuan/u);
  const buttonBody = page.slice(page.indexOf('const renderGuidedCandidate'), page.indexOf('const resourceProven ='));
  assert.doesNotMatch(buttonBody, /resolveBasicPriceImportRow|onSelect\(|setDrafts\(.*resourceCatalogId/u);
});

test('one compact candidate surface at a time, not duplicated against picker or raw evidence list', () => {
  const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
  assert.match(page, /guidedCandidates\.prior\.slice\(0, 2\)/u);
  assert.match(page, /guidedCandidates\.other\.slice\(0, 2\)/u);
  assert.match(page, /hiddenGuidedCount > 0/u);
  assert.match(page, /guidedCount > 0 && !lookupRows\.has\(row\.id\)/u);
  assert.match(page, /!sourceSpecUnverified && !resourceProven && guidedCount === 0/u);
  assert.match(page, /Kembali ke saran kandidat/u);
  assert.match(page, /Mengapa item baru belum dapat dibuat\?/u);
  assert.doesNotMatch(page, /<summary>Bandingkan kandidat dan bukti identitas<\/summary>/u);
  const oldDetails = page.slice(page.indexOf('<summary>Mengapa item baru belum dapat dibuat?</summary>'), page.indexOf('Hasil pencarian kosong belum membuktikan'));
  assert.doesNotMatch(oldDetails, /<li|\.map\(/u);
});
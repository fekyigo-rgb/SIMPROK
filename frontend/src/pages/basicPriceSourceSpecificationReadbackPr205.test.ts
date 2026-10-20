import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const server = readFileSync('../backend/src/basic-price/basic-price-import.service.ts', 'utf8');
const screen = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const contract = readFileSync('src/utils/basicPriceImportDisplay.ts', 'utf8');

test('PR205 source specification readback: use the existing source evidence, not a second writer', () => {
  assert.match(server, /sourceSpecifications: sourceSpecificationEvidence\(r\.rawSourceContext\)/u);
  assert.match(contract, /sourceSpecifications\?: Array<\{ label: string; value: string \| null \}>/u);
  assert.match(screen, /row\.sourceSpecifications\.map/u);
  assert.match(screen, /Spesifikasi dari berkas · perlu diperiksa/u);
  assert.match(screen, /belum menjadi bukti identitas kanonis/u);
  assert.doesNotMatch(screen, /Ajukan Pemeriksaan Item|requestBasicPriceIdentityReview\(/u);
});

test('saved source specification decisions no longer show a contradictory needs-review heading', () => {
  assert.match(screen, /row\.specificationDecision \? 'Spesifikasi dari berkas · sudah diperiksa' : 'Spesifikasi dari berkas · perlu diperiksa'/u);
  assert.match(screen, /Spesifikasi asli berkas sudah diperiksa dan keputusan tercatat/u);
  assert.match(screen, /Ini bukan otomatis bukti bahwa dua item katalog identik/u);
  assert.match(screen, /pencocokan identitas tetap dilakukan SIMPROK/u);
});

test('PR205 specification review does not advertise an item-selection action that the server forbids', () => {
  assert.match(screen, /const sourceSpecUnverified = row\.machineProposal\?\.blockingFacts\.includes\('SOURCE_SPECIFICATION_UNVERIFIED'\)/u);
  assert.match(screen, /!sourceSpecUnverified && !resourceProven/u);
  assert.match(screen, /!sourceSpecUnverified && lookupRows\.has\(row\.id\)/u);
  assert.match(screen, /Spesifikasi pada berkas belum diperiksa sebagai bukti identitas/u);
  assert.match(screen, /Anda dapat meninjau nanti/u);
  assert.match(screen, />Tolak<\/button>/u);
});

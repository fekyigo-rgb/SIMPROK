import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  basicPriceReviewCompass,
  type BasicPriceImportRowSummary,
} from './basicPriceImportDisplay.ts';

type Row = Pick<BasicPriceImportRowSummary, 'status' | 'machineProposal'>;
const row = (candidates: Array<{
  name: string;
  hasPriorHumanDecision: boolean;
  specificationUnproved: boolean;
  unprovedSpecificationFacts: string[];
}>, blockers: string[] = [], pairProven = false): Row => ({
  status: 'NEEDS_REVIEW',
  machineProposal: {
    identityPairProven: pairProven,
    blockingFacts: blockers,
    resource: { candidates },
  } as unknown as BasicPriceImportRowSummary['machineProposal'],
});

test('compass: Paku khusus menunjukkan spesifikasi yang belum terbukti, bukan otomatis sama', () => {
  const message = basicPriceReviewCompass(row([{
    name: 'Paku 5-7 cm', hasPriorHumanDecision: true,
    specificationUnproved: true, unprovedSpecificationFacts: ['segala Merk'],
  }]));
  assert.match(message ?? '', /Paku 5-7 cm/u);
  assert.match(message ?? '', /segala Merk/u);
  assert.match(message ?? '', /belum menetapkan identitas/u);
  assert.match(message ?? '', /hanya pilih jika benar-benar sama/u);
});

test('compass: Semen tetap ambigu walaupun pilihan manusia terdahulu tersedia', () => {
  const message = basicPriceReviewCompass(row([
    { name: 'Semen Portlan', hasPriorHumanDecision: true, specificationUnproved: false, unprovedSpecificationFacts: [] },
    { name: 'Semen Portland / Tonasa', hasPriorHumanDecision: true, specificationUnproved: false, unprovedSpecificationFacts: [] },
    { name: 'Semen Warna', hasPriorHumanDecision: false, specificationUnproved: false, unprovedSpecificationFacts: [] },
  ]));
  assert.match(message ?? '', /3 kandidat/u);
  assert.match(message ?? '', /2 kandidat memiliki riwayat pilihan manusia/u);
  assert.match(message ?? '', /bukan bukti otomatis/u);
  assert.match(message ?? '', /merek, ukuran, atau mutu/u);
});

test('compass: tidak menampilkan tuntunan review saat mesin sudah membuktikan pasangan atau baris sudah siap', () => {
  assert.equal(basicPriceReviewCompass(row([], [], true)), null);
  assert.equal(basicPriceReviewCompass({ ...row([]), status: 'READY_FOR_SUBMISSION' }), null);
  assert.equal(basicPriceReviewCompass({ status: 'NEEDS_REVIEW', machineProposal: null }), null);
});

test('compass: sumber yang belum terverifikasi harus diperiksa dahulu', () => {
  const message = basicPriceReviewCompass(row([], ['SOURCE_SPECIFICATION_UNVERIFIED']));
  assert.match(message ?? '', /periksa spesifikasi yang tertulis di Excel/u);
});

test('compass: kehadiran pengingat tidak membuat pemilihan atau penyimpanan otomatis', () => {
  const helper = readFileSync('src/utils/basicPriceImportDisplay.ts', 'utf8');
  const page = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
  assert.match(page, /basicPriceReviewCompass\(row\)/u);
  assert.match(page, /aria-label="Panduan langkah berikutnya"/u);
  assert.match(helper, /presentation ONLY|Presentation ONLY|Presentation ONLY|Presentation ONLY/i);
  assert.doesNotMatch(helper.slice(helper.indexOf('export function basicPriceReviewCompass('), helper.indexOf('export function rowIdentityAdmissionOffered(')), /fetch\(|\.create\(|\.update\(|GenUI|persist/i);
});

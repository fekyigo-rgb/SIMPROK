import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  canProposePrivateExplorerItem,
  type BasicPriceExplorerItem,
} from '../utils/basicPriceExplorerDisplay.ts';
import { submissionStatusLabel } from '../utils/basicPriceWorkflowDisplay.ts';
import { PROPOSAL_ALREADY_SENT } from '../utils/basicPriceDetailChange.ts';

const price = (assetScope: BasicPriceExplorerItem['assetScope'], alreadyProposed?: boolean | null) =>
  ({ assetScope, alreadyProposed } as BasicPriceExplorerItem);

test('BP-MULTI-ACTION-01: proposal only when private, authorized, and provably unsubmitted', () => {
  assert.equal(canProposePrivateExplorerItem(price('WORKSPACE_PRIVATE', false), true), true);
  assert.equal(canProposePrivateExplorerItem(price('WORKSPACE_PRIVATE', true), true), false);
  assert.equal(canProposePrivateExplorerItem(price('WORKSPACE_PRIVATE'), true), false);
  assert.equal(canProposePrivateExplorerItem(price('SIMPROK_CATALOG', null), true), false);
  assert.equal(canProposePrivateExplorerItem(price('WORKSPACE_PRIVATE', false), false), false);
});

const explorer = readFileSync('src/pages/BasicPriceExplorerPage.tsx', 'utf8');
const detail = readFileSync('src/components/basic-price/BasicPriceDetailPanel.tsx', 'utf8');

test('BP-MULTI-ACTION-01: select one or this page only, not invisible other pages', () => {
  assert.match(explorer, /aria-label="Pilih semua harga di halaman ini"/u);
  assert.match(explorer, /aria-label=\{'Pilih harga ' \+ item\.resource\.name\}/u);
  assert.match(explorer, /visibleRows\.every\(\(item\) => selectedIds\.has\(item\.basicPriceId\)\)/u);
  assert.match(explorer, /const selectedRows = visibleRows\.filter/u);
  assert.match(explorer, /replaceSelectedIds\(new Set\(\)\)/u);
  assert.match(explorer, /const replaceSelectedIds = [\s\S]*resetCorrectionForm\(\);[\s\S]*setSelectedIds\(next\);/u);
  assert.match(explorer, /const resetCorrectionForm = [\s\S]*setCorrectionOpen\(false\);[\s\S]*setCorrectionWinnerId\(''\);[\s\S]*setCorrectionReason\(''\);[\s\S]*setCorrectionConfirmed\(false\);/u);
  assert.match(explorer, /colSpan=\{8\}/u);
});

test('BP-MULTI-ACTION-01: export is canonical; private owner removal uses governed route', () => {
  assert.match(explorer, /item\.price/u);
  assert.match(explorer, /new Blob\(/u);
  assert.match(explorer, /basic-price-terpilih\.csv/u);
  assert.match(explorer, /removableRows = selectedRows\.filter\(\(item\) => item\.canRemoveOwn === true\)/u);
  assert.match(explorer, /removeOwnBasicPrice\(item\.basicPriceId\)/u);
  assert.match(explorer, /disabled=\{selectionBusy \|\| !removableRows\.length\}/u);
  assert.match(explorer, /className="bp-btn bp-btn--sm bp-btn--proposal"/u);
  const css = readFileSync('src/styles/basicPrice.css', 'utf8');
  assert.match(css, /\.bp-selectionbar \.bp-btn--proposal\s*\{[^}]*background:/u);
});

test('BP-CLEAN-01: protected private prices receive truthful removal feedback', () => {
  assert.doesNotMatch(explorer, /bukan milik privat yang boleh dihapus/u);
  assert.match(explorer, /mempunyai hubungan\/riwayat yang dilindungi/u);
});

test('BP-MULTI-ACTION-01: proposal uses original writer and persisted status on reopening Detail', () => {
  assert.match(explorer, /submitPrivateBasicPrice\(item\.basicPriceId\)/u);
  assert.match(detail, /detail\.detail\.price\.alreadyProposed === true/u);
  assert.match(detail, /detail\.detail\.price\.alreadyProposed === false/u);
});

test('BP-PROPOSER-STATUS-01: use the canonical submission label, never a curator-only door', () => {
  assert.equal(submissionStatusLabel('UNDER_REVIEW'), 'Sedang ditinjau');
  assert.equal(submissionStatusLabel('NEEDS_CORRECTION'), 'Perlu koreksi');
  assert.equal(submissionStatusLabel('RESUBMITTED'), 'Diajukan ulang');
  assert.equal(submissionStatusLabel('ACCEPTED'), 'Diterima untuk verifikasi');
  assert.equal(submissionStatusLabel('PUBLISHED'), 'Diterbitkan');
  assert.match(PROPOSAL_ALREADY_SENT, /sudah diusulkan ke SIMPROK/u);
  assert.doesNotMatch(PROPOSAL_ALREADY_SENT, /Pengajuan harga/u);
  assert.match(detail, /detail\.detail\.proposalStatus/u);
  assert.match(detail, /submissionStatusLabel\(detail\.detail\.proposalStatus\)/u);
  assert.match(detail, /setDetailEpoch\(\(epoch\) => epoch \+ 1\)/u);
});

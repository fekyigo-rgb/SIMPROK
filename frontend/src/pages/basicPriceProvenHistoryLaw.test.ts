import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * BP-HISTORY-ONE-TRUTH — Owner PASS.
 * Contract and surface guards; the backend behavioural proof lives in
 * backend/src/basic-price/basic-price-proven-history.spec.ts.
 */
const panel = readFileSync('src/components/basic-price/BasicPriceDetailPanel.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceExplorer.ts', 'utf8');
const typeContract = readFileSync('src/utils/basicPriceExplorerDisplay.ts', 'utf8');
const service = readFileSync('../backend/src/basic-price/basic-price.service.ts', 'utf8');
const canonical = readFileSync('../backend/src/basic-price/basic-price-proven-history.ts', 'utf8');

test('Riwayat Detail consumes backend priceHistory, never client-matches prices', () => {
  assert.match(panel, /detail\.detail\.priceHistory/);
  assert.match(panel, /priceHistory\.entries\.slice\(0, visibleHistoryCount\)/);
  assert.doesNotMatch(panel, /priceHistory\.entries\.sort\(/);
  assert.match(service, /priceHistory: await this\.readProvenPriceHistory\(row, workspaceId, asOf\)/);
  assert.match(canonical, /sameSourceObservationPredecessorId/);
});

test('Frontend displays Backend labels and source, initial date hidden', () => {
  assert.match(panel, /entry\.changeLabel/);
  assert.match(panel, /entry\.actionLabel === 'Harga Awal'/);
  assert.match(panel, /entry\.recordedAt/);
  assert.match(panel, /entry\.sourceName \?\? 'Belum tercatat'/);
  assert.match(typeContract, /changeLabel: 'Terkini' \| 'Diperbarui' \| 'Dikoreksi' \| 'Harga Awal'/);
});

test('Long history stays progressively readable without deleting entries', () => {
  assert.match(panel, /visibleHistoryCount, setVisibleHistoryCount/);
  assert.match(panel, /Lihat riwayat lainnya/);
  assert.match(panel, /priceHistory\.truncated/);
});

test('Existing correction-only contract and permission door remain untouched', () => {
  assert.match(service, /corrections: await this\.readCorrectionLineage/);
  assert.match(service, /readCorrectionLineage\(/);
  assert.match(api, /fetchBasicPriceDetail/);
  assert.doesNotMatch(panel, /supersedesBasicPriceId\s*===/);
});

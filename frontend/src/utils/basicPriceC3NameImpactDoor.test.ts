import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../components/basic-price/BasicPriceDetailPanel.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/basicPriceExplorer.ts', import.meta.url), 'utf8');

test('BP-C3: name inspection is a user-triggered read-only impact call, never an optimistic rename', () => {
  assert.match(panel, /Periksa usulan nama baku/u);
  assert.match(panel, /Periksa dampak, tanpa menyimpan/u);
  assert.match(panel, /previewCatalogNameImpact\(item\.resource\.id, nameProposal\)/u);
  assert.match(panel, /Belum disimpan/u);
  const subpanel = panel.slice(panel.indexOf('BP-C3 — catalog name impact preview'), panel.indexOf('GAP-B — THREE SENTENCES'));
  assert.doesNotMatch(subpanel, /updateResourceCatalog|renameResourceCatalog|method: ['"]PATCH['"]/u);
  assert.match(api, /withQuery\('\/basic-prices\/catalog-name-impact\/'/u);
  assert.match(api, /writable: false/u);
});

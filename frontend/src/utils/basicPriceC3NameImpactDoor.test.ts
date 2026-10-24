import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../components/basic-price/BasicPriceDetailPanel.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/basicPriceExplorer.ts', import.meta.url), 'utf8');

test('BP-C3: impact preview stays read-only and write needs curator evidence', () => {
  assert.match(panel, /Periksa usulan nama baku/u);
  assert.match(panel, /Periksa dampak, tanpa menyimpan/u);
  assert.match(panel, /previewCatalogNameImpact\(item\.resource\.id, nameProposal\)/u);
  assert.match(panel, /Pemeriksaan ini belum menyimpan apa pun/u);
  assert.match(panel, /hasPermission\('AHSP_RESOURCE_IDENTITY_DECIDE'\)/u);
  assert.match(panel, /nameCorrectionConfirmed/u);
  assert.match(panel, /nameCorrectionEvidence\.trim\(\)\.length < 20/u);
  assert.match(panel, /correctActiveResourceCatalogName\(item\.resource\.id/u);
  const subpanel = panel.slice(panel.indexOf('BP-C3 — catalog name impact preview'), panel.indexOf('GAP-B — THREE SENTENCES'));
  assert.doesNotMatch(subpanel, /updateResourceCatalog|renameResourceCatalog|method: ['"]PATCH['"]/u);
  assert.match(api, /withQuery\('\/basic-prices\/catalog-name-impact\/'/u);
  assert.match(api, /writable: false/u);
});

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
  assert.match(panel, /Bukti perlu minimal 20 karakter/u);
  assert.match(panel, /Simpan belum aktif: lengkapi bukti identitas minimal 20 karakter/u);
  assert.match(panel, /Alasan perlu minimal 10 karakter/u);
  assert.match(panel, /Nama katalog saat ini:/u);
  assert.match(panel, /Nama yang diusulkan:/u);
  assert.match(panel, /whiteSpace: 'pre-wrap'/u);
  assert.match(panel, /aria-describedby="bp-c3-evidence-guidance"/u);
  assert.match(panel, /correctActiveResourceCatalogName\(item\.resource\.id/u);
  assert.match(panel, /NOMENCLATURE_VERIFICATION_REQUIRED/u);
  assert.match(panel, /nomenclatureVerified/u);
  assert.match(panel, /confirmedCatalogCode/u);
  assert.match(panel, /nameSourceReference\.trim\(\)\.length < 12/u);
  assert.match(panel, /Rujukan dokumen yang membuktikan makna istilah/u);
  assert.match(panel, /SIMPROK tidak menganggapnya sama secara otomatis/u);
  const subpanel = panel.slice(panel.indexOf('BP-C3 — catalog name impact preview'), panel.indexOf('GAP-B — THREE SENTENCES'));
  assert.doesNotMatch(subpanel, /updateResourceCatalog|renameResourceCatalog|method: ['"]PATCH['"]/u);
  assert.match(api, /withQuery\('\/basic-prices\/catalog-name-impact\/'/u);
  assert.match(api, /writable: false/u);
});

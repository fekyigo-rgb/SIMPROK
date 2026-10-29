import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ahsp = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');
const ahspDoor = readFileSync('src/components/ahsp/CatalogNameReviewDoor.tsx', 'utf8');
const basicPriceDoor = readFileSync('src/components/basic-price/BasicPriceDetailPanel.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceExplorer.ts', 'utf8');
const controller = readFileSync('../backend/src/resource-catalog/resource-observation.controller.ts', 'utf8');
const writer = readFileSync('../backend/src/resource-catalog/resource-catalog-name-correction.service.ts', 'utf8');
const spelling = readFileSync('../backend/src/resource-catalog/observed-resource-name-review.service.ts', 'utf8');

test('catalog-name editor uses a full readable row rather than a 16rem grid column', () => {
  const block = css.match(/\.ahsp-choice-list\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(block, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(block, /auto-fill/);
  assert.match(css, /\.ahsp-catalog-name-door\s*\{\s*width:\s*100%/);
  assert.match(css, /\.ahsp-catalog-name-door__field input,\s*\.ahsp-catalog-name-door__field textarea\s*\{\s*width:\s*100%/);
});

test('both Import AHSP and Basic Price share same writer and no-code confirmation rules', () => {
  for (const panel of [ahspDoor, basicPriceDoor]) {
    assert.match(panel, /confirmedCatalogName/);
    assert.match(panel, /confirmedCatalogBaseUnit/);
    assert.match(panel, /confirmedCatalogCode/);
    assert.match(panel, /nameImpactResult\.resourceCode|result\.resourceCode/);
    assert.match(panel, /correctActiveResourceCatalogName/);
    assert.match(panel, /sourceReference/);
  }
  for (const x of [api, controller, writer]) {
    assert.match(x, /confirmedCatalogName/);
    assert.match(x, /confirmedCatalogBaseUnit/);
  }
  assert.match(ahspDoor, /jangan membuat kode baru|bukan membuat kode baru|bukan kode buatan/);
  assert.match(basicPriceDoor, /Jangan membuat kode baru/);
  assert.match(writer, /CATALOG_NOMENCLATURE_NO_CODE_IDENTITY_MISMATCH/);
  assert.match(writer, /CATALOG_NOMENCLATURE_CODE_MISMATCH/);
  assert.match(writer, /resource\.name !== input\.confirmedCatalogName/);
  assert.match(writer, /resource\.baseUnit !== input\.confirmedCatalogBaseUnit/);
});

test('FLATBED only source notation never changes the physical name, capacity or identity engine', () => {
  assert.match(spelling, /function isFlatbedSpacingOnly/);
  assert.match(spelling, /normal !== rawName && reviewedName === normal/);
  assert.match(spelling, /isFlatbedSpacingOnly\(rawName, reviewedName\)/);
  assert.match(ahsp, /'Gunakan Pilihan: ' \+ choice\.name/);
  assert.match(ahsp, /'Tetapkan Item Baru'/);
});

test('source-specific new-resource evidence does not advertise Mini Excavator example on Kawat Beton', () => {
  const after = ahsp.slice(ahsp.indexOf('<details className="ahsp-specific-new-review">'));
  assert.doesNotMatch(after.slice(0, 2200), /Mini Excavator|Contoh: 40/);
  assert.match(after, /Salin spesifikasi persis dari nama sumber/);
  assert.match(after, /Jelaskan perbedaan teknis kandidat/);
});

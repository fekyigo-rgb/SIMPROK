import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ahsp = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const bp = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');
const resourceController = readFileSync('../backend/src/resource-catalog/resource-observation.controller.ts', 'utf8');
const resourceService = readFileSync('../backend/src/resource-catalog/resource-observation.service.ts', 'utf8');

test('AHSP shares Basic Price private decision vocabulary while preserving resource authority', () => {
  assert.match(bp, /Gunakan Pilihan/);
  assert.match(bp, /Tetapkan Item Baru/);
  assert.match(ahsp, /'Gunakan Pilihan: ' \+ choice\.name/);
  assert.match(ahsp, /'Tetapkan Item Baru'/);
  assert.match(ahsp, /Keputusan resource privat:/);
  assert.match(ahsp, /tanpa menunggu persetujuan pembelajaran bersama/);
  assert.match(ahsp, /void curateExisting\(group, at, choice, remember\)/);
  assert.match(ahsp, /path: '\/curate-existing'/);
  assert.match(ahsp, /path: '\/curate-new'/);
  assert.match(ahsp, /await loadObservations\('REFRESH'\)/);
  assert.match(ahsp, /readAgainFor\(reads, ticket, 'observations', \(\) => loadObservations\('REFRESH'\)\)/);
});

test('global teaching is not a gate for private identity resolution', () => {
  assert.match(ahsp, /<details className="ahsp-shared-learning-optional">/);
  assert.match(ahsp, /Pembelajaran bersama \(opsional, terpisah dari resource privat\)/);
  assert.match(ahsp, /Status ini tidak menghalangi keputusan resource privat/);
  assert.match(ahsp, /Ajukan pola keputusan yang sama untuk pembelajaran bersama/);
  assert.ok(!ahsp.includes('IQL_COPY.remember'));
  const mainGuidance = ahsp.indexOf('Keputusan resource privat:');
  const candidateChoice = ahsp.indexOf("'Gunakan Pilihan: '");
  const sharingDetail = ahsp.indexOf('<details className="ahsp-shared-learning-optional">');
  assert.ok(mainGuidance < candidateChoice && candidateChoice < sharingDetail);
  assert.ok(!ahsp.slice(mainGuidance, candidateChoice).includes('menunggu persetujuan orang lain'));
  assert.match(css, /\.ahsp-shared-learning-optional/);
});

test('backend already separates direct workspace decision from optional shared-learning proposal', () => {
  assert.match(resourceService, /if \(params\.rememberForIdenticalQuestions === true\) \{\s*return this\.curateExistingAndTeach\(params\)/);
  assert.match(resourceService, /status: ObservedResourceStatus\.RESOLVED_EXISTING/);
  assert.match(resourceService, /OR: \[\{ workspaceId: params\.workspaceId \}, \{ workspaceId: null \}\]/);
  assert.match(resourceController, /rememberForIdenticalQuestions:\s*body\.rememberForIdenticalQuestions === true/);
  assert.match(ahsp, /rememberForIdenticalQuestions: true/); // allowed ONLY if user expressly opts in
  assert.match(ahsp, /: \{ selectedResourceCatalogId: choice\.resourceCatalogId \}/);
});

test('new AHSP private resource still uses canonical resource admission and preserves optional global governance', () => {
  assert.match(ahsp, /ids: group\.ids\.slice\(0, 1\)/);
  assert.match(ahsp, /confirmedSpecifications: \{ \[evidence\.attribute\]: evidence\.value \}/);
  assert.match(ahsp, /refusedCandidateIds: evidence\.refusal\.candidateIds/);
  assert.match(ahsp, /candidateContextDigest: evidence\.refusal\.candidateContextDigest/);
  assert.match(ahsp, /remember: false/);
  assert.match(bp, /Item privat tidak memerlukan persetujuan katalog resmi SIMPROK/);
});

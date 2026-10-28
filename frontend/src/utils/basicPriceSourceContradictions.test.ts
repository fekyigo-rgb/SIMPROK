import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourceCatalogContradictions,
  supplierSourceClarification,
  threePartDimensions,
} from './basicPriceSourceContradictions.ts';

const proposal = (name: string, code: string | null) => ({
  status: 'NEEDS_REVIEW',
  code: 'M522c',
  name: 'Precast U-Ditch Ukuran 140 x 140 x 140',
  machineProposal: {
    identityPairProven: false,
    resource: {
      candidates: [{
        resourceCatalogId: 'catalog-uditch',
        name, code,
        type: 'MATERIAL',
        baseUnit: 'Unit',
        evidence: [], specificationUnproved: true,
        unprovedSpecificationFacts: [], hasPriorHumanDecision: true,
      }],
    },
  },
}) as unknown as Parameters<typeof sourceCatalogContradictions>[0];

test('M522c: same source code but 140x140x120 vs 140x140x140 is visibly disputed', () => {
  const row = proposal('Precast U-Ditch Ukuran 140 × 140 × 120', 'M522c');
  const findings = sourceCatalogContradictions(row);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'SAME_CODE_DIFFERENT_NAME');
  assert.equal(findings[0].dimensionDifferent, true);
  assert.match(findings[0].conflictText, /140 × 140 × 140/);
  assert.match(findings[0].conflictText, /140 × 140 × 120/);
  assert.match(findings[0].conflictText, /Belum terbukti/);
});

test('same literal name with different code flags a possible source code error, not certainty', () => {
  const x = proposal('Precast U-Ditch Ukuran 140 x 140 x 140', 'M522d');
  const findings = sourceCatalogContradictions(x);
  assert.equal(findings[0]?.kind, 'SAME_NAME_DIFFERENT_CODE');
  assert.match(findings[0].conflictText, /belum terbukti/i);
});

test('identical source code, name and size gives no false warning', () => {
  const row = proposal('Precast U-Ditch Ukuran 140 x 140 x 140', 'M522c');
  assert.deepEqual(sourceCatalogContradictions(row), []);
});

test('unverified candidate with no source code does not invent code equality', () => {
  const row = { ...proposal('Precast U-Ditch Ukuran 140 x 140 x 120', 'M522c'), code: null };
  assert.deepEqual(sourceCatalogContradictions(row), []);
});

test('recognized and decided rows are not reclassified by presentation helper', () => {
  const row = proposal('Precast U-Ditch Ukuran 140 x 140 x 120', 'M522c');
  assert.deepEqual(sourceCatalogContradictions({ ...row, status: 'READY_FOR_SUBMISSION' }), []);
  assert.deepEqual(sourceCatalogContradictions({ ...row, machineProposal: { ...row.machineProposal!, identityPairProven: true } }), []);
});

test('supplier clarification requests evidence without editing the original source or asserting fault', () => {
  const row = proposal('Precast U-Ditch Ukuran 140 x 140 x 120', 'M522c');
  const findings = sourceCatalogContradictions(row);
  const text = supplierSourceClarification({
    sourceRowNumber: 60,
    name: row.name,
    code: row.code,
    unit: 'Unit',
  }, findings);
  assert.match(text, /Baris dokumen sumber: 60/);
  assert.match(text, /Kode tertulis: M522c/);
  assert.match(text, /140 × 140 × 120/);
  assert.match(text, /konfirmasi tertulis/i);
  assert.match(text, /revisi resmi/i);
  assert.match(text, /tidak akan mengubah data Excel asli/i);
});

test('dimension comparison only reports literal 3-part dimensions', () => {
  assert.equal(threePartDimensions('U-Ditch 140x140x140'), '140 × 140 × 140');
  assert.equal(threePartDimensions('U-Ditch 140 × 140 × 120'), '140 × 140 × 120');
  assert.equal(threePartDimensions('U-Ditch 140 x 120'), null);
});

test('source workbook itself: two different sizes with code M522c surface documentary discrepancy', () => {
  const item60 = {
    ...proposal('Precast U-Ditch Ukuran 140 x 140 x 120', 'M522c'),
    id: 'row60',
    sourceRowNumber: 60,
    machineProposal: null,
  };
  const item59 = {
    id: 'row59',
    sourceRowNumber: 59,
    code: 'M522c',
    name: 'Precast U-Ditch Ukuran 140 x 140 x 120',
  };
  const target = { ...item60, name: 'Precast U-Ditch Ukuran 140 x 140 x 140' };
  const results = sourceCatalogContradictions(target, [target, item59]);
  assert.equal(results.length, 1);
  assert.equal(results[0].evidenceOrigin, 'SOURCE_ROW');
  assert.equal(results[0].otherSourceRowNumber, 59);
  assert.equal(results[0].dimensionDifferent, true);
  assert.match(results[0].conflictText, /baris 59/);
  assert.match(results[0].conflictText, /140 × 140 × 140/);
  assert.match(results[0].conflictText, /140 × 140 × 120/);
});

test('source workbook matching rows and unrelated codes are not falsely flagged', () => {
  const row = {
    ...proposal('Precast U-Ditch Ukuran 140 x 140 x 120', null),
    id: 'row60',
    sourceRowNumber: 60,
    machineProposal: null,
  };
  const twins = [{ id: 'row59', sourceRowNumber: 59, code: 'M522c', name: row.name }];
  const otherCode = [{ id: 'row59', sourceRowNumber: 59, code: 'M999', name: 'Precast U-Ditch Ukuran 140 x 140 x 120' }];
  assert.deepEqual(sourceCatalogContradictions(row, twins), []);
  assert.deepEqual(sourceCatalogContradictions(row, otherCode), []);
});

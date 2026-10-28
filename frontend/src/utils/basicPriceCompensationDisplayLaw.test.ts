import assert from 'node:assert/strict';
import test from 'node:test';
import {
  machinePickedResource,
  reviewRowBucket,
  rowMachineState,
  rowStateLabel,
  type BasicPriceImportRowSummary,
} from './basicPriceImportDisplay.ts';

const machineProvenRow = (compensated: boolean): BasicPriceImportRowSummary =>
  ({
    id: 'row-id',
    status: 'NEEDS_REVIEW',
    savedAsPrivatePrice: false,
    hasCompensatedDecision: compensated,
    machineProposal: {
      identityPairProven: true,
      resource: {
        status: 'RESOLVED',
        admissibleForResolve: true,
        resourceCatalogId: 'catalog-shared',
        resourceName: 'Pasir Halus',
        resourceCode: null,
        resourceType: 'MATERIAL',
        resourceBaseUnit: 'M3',
        candidates: [],
      },
      unit: { unitCode: 'M3' },
    },
  }) as unknown as BasicPriceImportRowSummary;

test('BP-C2 — withdrawing acceptance leaves machine proof visible but never bulk-ready', () => {
  const withdrawn = machineProvenRow(true);
  assert.equal(withdrawn.machineProposal?.identityPairProven, true);
  assert.equal(reviewRowBucket(withdrawn), 'NEEDS_REVIEW');
  assert.equal(rowStateLabel(withdrawn), 'Perlu keputusan ulang');
  assert.equal(rowMachineState(withdrawn), 'ATTENTION');
  assert.equal(machinePickedResource(withdrawn), null);
});

test('BP-C2 — healthy unaffected machine-proven rows retain automatic reuse', () => {
  const ordinary = machineProvenRow(false);
  assert.equal(reviewRowBucket(ordinary), 'RECOGNIZED');
  assert.equal(rowMachineState(ordinary), 'PROVEN');
  assert.equal(machinePickedResource(ordinary)?.id, 'catalog-shared');
});

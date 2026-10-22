/**
 * PR #205 — Owner's private specification contract: protective proof only.
 * The existing Identity Kernel remains the sole authority and is NOT changed.
 * Import-row specification has no separate persisted, trusted input yet:
 * absence of that input must never be represented as a proven difference.
 */
import {
  resolveResourceIdentity,
  type IdentityCatalogCandidate,
} from '../resource-catalog/resource-identity-resolution.kernel';

const candidate = (
  id: string,
  name: string,
  specifications?: unknown,
): IdentityCatalogCandidate => ({
  id,
  code: null,
  name,
  type: 'MATERIAL',
  baseUnit: 'BATANG',
  status: 'ACTIVE',
  ...(specifications === undefined ? {} : { specifications }),
});

function classify(rawName: string, catalogCandidates: IdentityCatalogCandidate[]) {
  return resolveResourceIdentity({
    reference: {
      rawName,
      rawCode: null,
      rawUnit: 'BATANG',
      resourceType: 'MATERIAL',
    },
    catalogCandidates,
    sourceSightings: [],
    reviewedMappings: [],
  });
}

describe('BP205-SPEC-BOUNDARY — one identity authority, no unproved specification admission', () => {
  it('SPEC-01: exact same name with a matching material designation can resolve', () => {
    const existing = candidate('wood-57', 'Kayu 5/7 cm');
    const answer = classify('Kayu 5/7 cm', [existing]);
    expect(answer.status).toBe('RESOLVED');
    expect(answer.resolvedResourceCatalogId).toBe(existing.id);
  });

  it('SPEC-02: a different stated size is never asserted as the same item', () => {
    const answer = classify('Kayu 5/7 cm', [candidate('wood-510', 'Kayu 5/10 cm')]);
    expect(answer.status).not.toBe('RESOLVED');
    expect(answer.resolvedResourceCatalogId).toBeNull();
  });

  it('SPEC-03: a generic name cannot inherit an unstated structured size', () => {
    const answer = classify('Kayu', [candidate('wood-57', 'Kayu', { ukuran: '5/7 cm' })]);
    expect(answer.status).toBe('NEEDS_REVIEW');
    expect(answer.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(answer.resolvedResourceCatalogId).toBeNull();
  });

  it('SPEC-04: missing brand or model must not inherit one from catalog', () => {
    const answer = classify('Pompa Air', [
      candidate('pump-model', 'Pompa Air', { merek: 'Shimizu', tipe: 'PS-128 BIT' }),
    ]);
    expect(answer.status).toBe('NEEDS_REVIEW');
    expect(answer.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(answer.resolvedResourceCatalogId).toBeNull();
  });

  it('SPEC-05: raw source name is not silently equated to a different size notation', () => {
    const answer = classify('Kayu 50x70 mm', [candidate('wood-57', 'Kayu 5/7 cm')]);
    expect(answer.status).not.toBe('RESOLVED');
    expect(answer.resolvedResourceCatalogId).toBeNull();
  });
});

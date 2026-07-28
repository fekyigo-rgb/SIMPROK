import { findProvenanceCandidate } from './basic-price-source-provenance.service';

describe('findProvenanceCandidate', () => {
  const WORKSPACE_ID = 'ws-01';
  const BATCH_SHA = 'batch-sha-owner';
  const CANONICAL_SHA = 'canonical-sha-bootstrap';

  const baseParams = {
    workspaceId: WORKSPACE_ID,
    batchSourceSha256: BATCH_SHA,
    sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
    parserContractVersion: 'RM02_BASIC_PRICE_01_V1',
    sourceRowNumber: 9,
    rawResourceCodeText: 'L.01',
    rawResourceNameText: 'Pekerja',
    rawUnitText: 'Org/Hari',
  };

  let client: {
    basicPriceSourceEquivalence: { findUnique: jest.Mock };
    resourceSourceIdentity: { findFirst: jest.Mock };
    resourceCatalog: { findFirst: jest.Mock };
  };

  beforeEach(() => {
    client = {
      basicPriceSourceEquivalence: { findUnique: jest.fn() },
      resourceSourceIdentity: { findFirst: jest.fn() },
      resourceCatalog: { findFirst: jest.fn() },
    };
  });

  it('negative (fail-closed): zero equivalence records means zero candidate, even for a row whose content would otherwise match perfectly — never guesses across source hashes on its own', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null);

    const result = await findProvenanceCandidate(client as any, baseParams);

    expect(result).toEqual({ candidate: null, equivalenceFound: false, canonicalSourceSha256: null });
    expect(client.resourceSourceIdentity.findFirst).not.toHaveBeenCalled();
  });

  it('positive: an authorized equivalence record plus an exact raw-field match returns the provenanced ResourceCatalog', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
      id: 'equiv-1',
      workspaceId: WORKSPACE_ID,
      batchSourceSha256: BATCH_SHA,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    client.resourceSourceIdentity.findFirst.mockResolvedValue({ resourceCatalogId: 'catalog-l01' });
    client.resourceCatalog.findFirst.mockResolvedValue({ id: 'catalog-l01', code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' });

    const result = await findProvenanceCandidate(client as any, baseParams);

    expect(result).toEqual({
      candidate: { resourceCatalogId: 'catalog-l01', code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'Org/Hari' },
      equivalenceFound: true,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    expect(client.resourceSourceIdentity.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        sourceSha256: CANONICAL_SHA,
        sheetName: baseParams.sheetName,
        parserContractVersion: baseParams.parserContractVersion,
        sourceRowNumber: 9,
        rawCode: 'L.01',
        rawName: 'Pekerja',
        rawUnit: 'Org/Hari',
      },
      select: { resourceCatalogId: true },
    });
  });

  it('negative: equivalence exists but this row has no exact raw-field match under the canonical hash — returns null candidate, not a best-effort guess', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
      id: 'equiv-1',
      workspaceId: WORKSPACE_ID,
      batchSourceSha256: BATCH_SHA,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    client.resourceSourceIdentity.findFirst.mockResolvedValue(null);

    const result = await findProvenanceCandidate(client as any, baseParams);

    expect(result).toEqual({ candidate: null, equivalenceFound: true, canonicalSourceSha256: CANONICAL_SHA });
    expect(client.resourceCatalog.findFirst).not.toHaveBeenCalled();
  });

  it('negative: the provenanced ResourceCatalog no longer exists/active — fails closed to null rather than referencing a dead identity', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
      id: 'equiv-1',
      workspaceId: WORKSPACE_ID,
      batchSourceSha256: BATCH_SHA,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    client.resourceSourceIdentity.findFirst.mockResolvedValue({ resourceCatalogId: 'catalog-retired' });
    client.resourceCatalog.findFirst.mockResolvedValue(null);

    const result = await findProvenanceCandidate(client as any, baseParams);

    expect(result).toEqual({ candidate: null, equivalenceFound: true, canonicalSourceSha256: CANONICAL_SHA });
  });

  it('scopes the equivalence lookup to exactly this workspace + batch source hash pair', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null);
    await findProvenanceCandidate(client as any, baseParams);
    expect(client.basicPriceSourceEquivalence.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_batchSourceSha256: { workspaceId: WORKSPACE_ID, batchSourceSha256: BATCH_SHA } },
    });
  });
});

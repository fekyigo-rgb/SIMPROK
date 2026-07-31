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
    sourceSection: 'LABOR' as const,
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
        sourceSection: 'LABOR',
        rawCode: 'L.01',
        rawName: 'Pekerja',
        rawUnit: 'Org/Hari',
      },
      select: { resourceCatalogId: true },
    });
    expect(client.resourceCatalog.findFirst).toHaveBeenCalledWith({
      where: { id: 'catalog-l01', workspaceId: WORKSPACE_ID, status: 'ACTIVE', type: 'LABOR' },
      select: { id: true, code: true, name: true, type: true, baseUnit: true },
    });
  });

  // RM-02D1-REMEDIATION-V3.2.1 (Blocker 2) — resource type safety.
  it('type safety: sourceSection scopes the ResourceSourceIdentity lookup — a same-raw-field identity recorded under a different section is never returned as a LABOR row\'s candidate', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
      id: 'equiv-1',
      workspaceId: WORKSPACE_ID,
      batchSourceSha256: BATCH_SHA,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    // Simulates the DB-level WHERE (workspaceId, sourceSha256, sheetName,
    // parserContractVersion, sourceRowNumber, sourceSection, rawCode,
    // rawName, rawUnit) genuinely finding nothing, because the recorded
    // identity at this row number is MATERIAL, not LABOR.
    client.resourceSourceIdentity.findFirst.mockImplementation(({ where }: { where: { sourceSection: string } }) =>
      Promise.resolve(where.sourceSection === 'MATERIAL' ? { resourceCatalogId: 'catalog-material-only' } : null),
    );

    const result = await findProvenanceCandidate(client as any, baseParams); // baseParams.sourceSection = 'LABOR'

    expect(result).toEqual({ candidate: null, equivalenceFound: true, canonicalSourceSha256: CANONICAL_SHA });
    expect(client.resourceCatalog.findFirst).not.toHaveBeenCalled();
  });

  it('type safety: the ResourceCatalog lookup itself is scoped to type = sourceSection, so a stale identity pointing at a retyped catalog row never surfaces', async () => {
    client.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
      id: 'equiv-1',
      workspaceId: WORKSPACE_ID,
      batchSourceSha256: BATCH_SHA,
      canonicalSourceSha256: CANONICAL_SHA,
    });
    client.resourceSourceIdentity.findFirst.mockResolvedValue({ resourceCatalogId: 'catalog-retyped' });
    // The DB-level WHERE includes type: 'LABOR' -- a catalog row that has
    // since become MATERIAL genuinely will not match, so findFirst returns null.
    client.resourceCatalog.findFirst.mockResolvedValue(null);

    const result = await findProvenanceCandidate(client as any, baseParams);

    expect(result).toEqual({ candidate: null, equivalenceFound: true, canonicalSourceSha256: CANONICAL_SHA });
    expect(client.resourceCatalog.findFirst).toHaveBeenCalledWith({
      where: { id: 'catalog-retyped', workspaceId: WORKSPACE_ID, status: 'ACTIVE', type: 'LABOR' },
      select: { id: true, code: true, name: true, type: true, baseUnit: true },
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

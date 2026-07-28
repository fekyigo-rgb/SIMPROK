import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BasicPriceRowMappingCandidatesService, normalizeResourceName } from './basic-price-row-mapping-candidates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('normalizeResourceName', () => {
  it('trims, collapses internal whitespace, and lowercases', () => {
    expect(normalizeResourceName('  Semen   Portland  ')).toBe('semen portland');
    expect(normalizeResourceName('Semen Portland')).toBe('semen portland');
    expect(normalizeResourceName('SEMEN PORTLAND')).toBe('semen portland');
  });
});

describe('BasicPriceRowMappingCandidatesService', () => {
  let service: BasicPriceRowMappingCandidatesService;
  let prisma: {
    basicPriceImportRow: { findFirst: jest.Mock };
    basicPriceSourceEquivalence: { findUnique: jest.Mock };
    resourceSourceIdentity: { findFirst: jest.Mock };
    resourceCatalog: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
  };

  const WORKSPACE_ID = 'ws-01';
  const BATCH_ID = 'batch-01';
  const ROW_ID = 'row-01';

  const baseRow = {
    id: ROW_ID,
    sourceSection: 'MATERIAL',
    sourceRowNumber: 33,
    rawResourceCodeText: null,
    rawResourceNameText: 'Semen Portland',
    rawUnitText: 'Zak',
    batch: { workspaceId: WORKSPACE_ID, sourceSha256: 'batch-sha', selectedSheetName: 'SHEET', parserContractVersion: 'V1' },
  };

  beforeEach(async () => {
    prisma = {
      basicPriceImportRow: { findFirst: jest.fn() },
      basicPriceSourceEquivalence: { findUnique: jest.fn() },
      resourceSourceIdentity: { findFirst: jest.fn() },
      resourceCatalog: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
    };
    // Default: no equivalence record for this batch source hash (fail-closed default).
    prisma.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [BasicPriceRowMappingCandidatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BasicPriceRowMappingCandidatesService>(BasicPriceRowMappingCandidatesService);
  });

  it('throws NotFound when the row does not belong to the caller workspace', async () => {
    prisma.basicPriceImportRow.findFirst.mockResolvedValue({ ...baseRow, batch: { ...baseRow.batch, workspaceId: 'other-workspace' } });
    await expect(service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when the row does not exist in this batch', async () => {
    prisma.basicPriceImportRow.findFirst.mockResolvedValue(null);
    await expect(service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('positive: returns the single unambiguous normalized-name candidate, no provenance signal when no equivalence record exists', async () => {
    prisma.basicPriceImportRow.findFirst.mockResolvedValue({ ...baseRow, rawResourceNameText: '  Semen   Portland ' });
    prisma.$queryRaw.mockResolvedValue([{ resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' }]);

    const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);

    expect(result).toEqual({
      rowId: ROW_ID,
      matchBasis: 'NORMALIZED_NAME',
      candidates: [{ resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' }],
      provenanceCandidate: null,
      provenanceEquivalenceFound: false,
      conflict: false,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('negative: an ambiguous name returns every candidate, none singled out or preferred (review signal only, no decision made)', async () => {
    prisma.basicPriceImportRow.findFirst.mockResolvedValue(baseRow);
    prisma.$queryRaw.mockResolvedValue([
      { resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' },
      { resourceCatalogId: 'resource-02', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' },
    ]);

    const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.resourceCatalogId)).toEqual(['resource-01', 'resource-02']);
    expect(result.conflict).toBe(false);
  });

  it('negative: no match returns an empty candidate list, never a fabricated suggestion', async () => {
    prisma.basicPriceImportRow.findFirst.mockResolvedValue({ ...baseRow, rawResourceNameText: 'Resource With No Catalog Match' });
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);
    expect(result.candidates).toEqual([]);
    expect(result.provenanceCandidate).toBeNull();
  });

  describe('SOURCE_ROW_PROVENANCE (RM-02D1-REMEDIATION-V3.1)', () => {
    it('fail-closed: zero equivalence record means provenanceCandidate is always null, regardless of what normalized-name matching finds', async () => {
      prisma.basicPriceImportRow.findFirst.mockResolvedValue(baseRow);
      prisma.$queryRaw.mockResolvedValue([{ resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' }]);
      prisma.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null);

      const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);

      expect(result.provenanceCandidate).toBeNull();
      expect(result.provenanceEquivalenceFound).toBe(false);
      expect(prisma.resourceSourceIdentity.findFirst).not.toHaveBeenCalled();
    });

    it('positive: an authorized equivalence record plus a matching provenance identity is surfaced as provenanceCandidate, agreeing with normalized-name — no conflict', async () => {
      prisma.basicPriceImportRow.findFirst.mockResolvedValue(baseRow);
      prisma.$queryRaw.mockResolvedValue([{ resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' }]);
      prisma.basicPriceSourceEquivalence.findUnique.mockResolvedValue({ canonicalSourceSha256: 'canonical-sha' });
      prisma.resourceSourceIdentity.findFirst.mockResolvedValue({ resourceCatalogId: 'resource-01' });
      prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' });

      const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);

      expect(result.provenanceCandidate).toEqual({ resourceCatalogId: 'resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' });
      expect(result.provenanceEquivalenceFound).toBe(true);
      expect(result.conflict).toBe(false);
    });

    it('conflict: provenance points to a different ResourceCatalog than normalized-name matching — both are returned, conflict is true, neither is dropped or silently preferred', async () => {
      prisma.basicPriceImportRow.findFirst.mockResolvedValue(baseRow);
      prisma.$queryRaw.mockResolvedValue([{ resourceCatalogId: 'resource-NAME-MATCH', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' }]);
      prisma.basicPriceSourceEquivalence.findUnique.mockResolvedValue({ canonicalSourceSha256: 'canonical-sha' });
      prisma.resourceSourceIdentity.findFirst.mockResolvedValue({ resourceCatalogId: 'resource-PROVENANCE' });
      prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'resource-PROVENANCE', code: 'X', name: 'Semen Portland (provenanced)', type: 'MATERIAL', baseUnit: 'Zak' });

      const result = await service.findCandidatesForRow(WORKSPACE_ID, BATCH_ID, ROW_ID);

      expect(result.candidates.map((c) => c.resourceCatalogId)).toEqual(['resource-NAME-MATCH']);
      expect(result.provenanceCandidate?.resourceCatalogId).toBe('resource-PROVENANCE');
      expect(result.conflict).toBe(true);
    });
  });
});

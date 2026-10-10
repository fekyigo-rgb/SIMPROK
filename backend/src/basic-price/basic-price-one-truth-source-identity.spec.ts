import { Test } from '@nestjs/testing';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { PrismaService } from '../prisma/prisma.service';
import { sameSourceObservationPredecessorId } from '../common/basic-price-workflow.projection';

describe('BP-ONE-TRUTH-01 — same-source observation display, no money inheritance', () => {
  const ws = 'ws-one-truth';
  const ancestorId = '887979b9-ff23-44bc-be24-df82daeab9dc';
  const middleId = 'c96f6ef4-9f7e-4731-846b-0cd21f7afcd1';
  const latestId = 'e50d3edc-be5f-418a-9aa3-82b35852f192';
  const provenance = (predecessor: string, sameSourceIdentity = true) => [
    {
      before: {
        semantic: 'NEW_OBSERVATION',
        observedAfterBasicPriceId: predecessor,
      },
      after: {
        semantic: 'NEW_OBSERVATION',
        sameSourceIdentity,
        sourceIdentityName: null,
      },
    },
  ];
  const base = {
    workspaceId: ws,
    assetScope: 'WORKSPACE_PRIVATE',
    value: '150000.00',
    effectiveDate: new Date('2026-08-26T00:00:00Z'),
    validUntil: null,
    reviewDate: null,
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'COMMUNITY_REPORT',
    freshnessStatus: 'CURRENT',
    region: { id: 'region-01', code: 'AMB', name: 'Teluk Ambon Baguala' },
    regionCoverageSet: { members: [] },
    resource: {
      id: 'resource-01',
      code: 'LAB-01',
      name: 'Tukang Besi',
      type: 'LABOR',
      baseUnit: 'Org/Hari',
    },
    sourceSubmission: null,
    sourceImportRow: null,
    provenanceCorrections: [],
  };

  const latest = {
    ...base,
    id: latestId,
    value: '167500.00',
    effectiveDate: new Date('2026-09-30T00:00:00Z'),
    provenanceCorrections: provenance(middleId),
  };
  const middle = {
    ...base,
    id: middleId,
    value: '167000.00',
    effectiveDate: new Date('2026-09-02T00:00:00Z'),
    provenanceCorrections: provenance(ancestorId),
  };
  const ancestor = {
    ...base,
    id: ancestorId,
    sourceImportRow: {
      batch: { sourceVendorName: null, sourceOrganizationName: 'Tim Simprok' },
    },
  };

  const setup = async (...pages: unknown[][]) => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      basicPrice: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    for (const page of pages)
      prisma.basicPrice.findMany.mockResolvedValueOnce(page);
    const module = await Test.createTestingModule({
      providers: [
        BasicPriceService,
        BasicPriceEligibilityPolicy,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return { service: module.get(BasicPriceService), prisma };
  };

  it('excludes only an older proven observation from Explorer and the resource offer', async () => {
    const { service, prisma } = await setup(
      [{ id: latestId }],
      [latest],
      [middle],
      [ancestor],
    );
    const provenLinks = [
      { predecessorId: middleId, descendantId: latestId, depth: 1 },
      { predecessorId: ancestorId, descendantId: latestId, depth: 2 },
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(provenLinks)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(provenLinks)
      .mockResolvedValueOnce([]);
    const result = await service.findAllForWorkspace(ws);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      basicPriceId: latestId,
      price: '167500.00',
      sourceName: 'Tim Simprok',
    });
    const [countArgs] = prisma.basicPrice.count.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(countArgs.where.AND).toContainEqual({
      id: { notIn: [middleId, ancestorId] },
    });

    prisma.basicPrice.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: latestId }])
      .mockResolvedValueOnce([{ id: latestId, value: '167500.00' }]);
    const byResource = await service.findByResource(base.resource.id, ws);
    expect(byResource).toHaveLength(1);
    const lastCall = prisma.basicPrice.findMany.mock.calls.at(-1) as [
      { where: { id: { notIn: string[] } } },
    ];
    expect(lastCall[0].where.id.notIn).toEqual(
      expect.arrayContaining([middleId, ancestorId]),
    );
  });

  it('does not remove an older observation when its newer candidate is ineligible', async () => {
    const { service, prisma } = await setup([], [ancestor]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { predecessorId: ancestorId, descendantId: latestId, depth: 1 },
      ])
      .mockResolvedValueOnce([]);
    prisma.basicPrice.count.mockResolvedValue(1);
    await service.findAllForWorkspace(ws);
    const [countArgs] = prisma.basicPrice.count.mock.calls[0] as [
      { where: { AND: unknown[] } },
    ];
    expect(countArgs.where.AND).not.toContainEqual({
      id: { notIn: [ancestorId] },
    });
  });

  it('fails closed on an excessively deep observation history', async () => {
    const { service, prisma } = await setup([]);
    prisma.$queryRaw.mockResolvedValue([
      { predecessorId: ancestorId, descendantId: latestId, depth: 1000 },
    ]);
    await expect(service.findAllForWorkspace(ws)).rejects.toThrow(
      'OBSERVATION_OFFER_LINEAGE_INCOMPLETE',
    );
    expect(prisma.basicPrice.count).not.toHaveBeenCalled();
  });

  it('BP-ONE-TRUTH-01 — reconciles exact source-document reimports without losing a same-day conflict', async () => {
    const { prisma } = await setup();
    const importOnSep1 = '33333333-3333-4333-8333-333333333333';
    const importOnSep2 = '44444444-4444-4444-8444-444444444444';
    const importedRows = [
      {
        id: ancestorId,
        docKey: 'same-hash-sheet-row-and-publisher',
        amount: '150000',
        effectiveDate: new Date('2026-08-26T00:00:00Z'),
      },
      {
        id: importOnSep1,
        docKey: 'same-hash-sheet-row-and-publisher',
        amount: '150000',
        effectiveDate: new Date('2026-09-01T00:00:00Z'),
      },
      {
        id: importOnSep2,
        docKey: 'same-hash-sheet-row-and-publisher',
        amount: '150000',
        effectiveDate: new Date('2026-09-02T00:00:00Z'),
      },
    ];
    const reconcile = async (descendantId: string, date: string) => {
      prisma.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([
          { predecessorId: ancestorId, descendantId, depth: 1 },
        ])
        .mockResolvedValueOnce(importedRows);
      prisma.basicPrice.findMany
        .mockReset()
        .mockResolvedValueOnce([
          { id: descendantId, effectiveDate: new Date(date + 'T00:00:00Z') },
        ])
        .mockResolvedValueOnce(importedRows.map((row) => ({ id: row.id })));
      return BasicPriceService.olderSameSourceObservationOfferIds(
        prisma as never,
        new BasicPriceEligibilityPolicy(),
        ws,
        new Date(date + 'T12:00:00Z'),
        {},
      );
    };
    const sameDay = await reconcile(middleId, '2026-09-02');
    expect(sameDay).toContain(ancestorId);
    expect(sameDay).toContain(importOnSep1);
    expect(sameDay).not.toContain(importOnSep2);

    const latestOffer = await reconcile(latestId, '2026-09-30');
    expect(latestOffer).toEqual(
      expect.arrayContaining([ancestorId, importOnSep1, importOnSep2]),
    );
    const [docQuery] = prisma.$queryRaw.mock.calls[1] as [
      { strings: readonly string[] },
    ];
    const predicate = docQuery.strings.join(' ');
    expect(predicate).toContain('sourceSha256');
    expect(predicate).toContain('selectedSheetName');
    expect(predicate).toContain('sourceRowNumber');
    expect(predicate).toContain('sourcePriceCellAddress');
    expect(predicate).toContain('sourceUnitCellAddress');
    expect(predicate).toContain('sourceOrganizationName');
    expect(predicate).toContain('sourceVendorName');
  });

  it('BP-ONE-TRUTH-01 — conflicting monetary readings of identical document bytes are never collapsed', async () => {
    const { prisma } = await setup();
    const left = {
      id: ancestorId,
      docKey: 'same-document-row',
      amount: '150000',
      effectiveDate: new Date('2026-08-26T00:00:00Z'),
    };
    const right = {
      id: '44444444-4444-4444-8444-444444444444',
      docKey: 'same-document-row',
      amount: '167000',
      effectiveDate: new Date('2026-09-02T00:00:00Z'),
    };
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([left, right]);
    prisma.basicPrice.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: left.id }, { id: right.id }]);
    const excluded = await BasicPriceService.olderSameSourceObservationOfferIds(
      prisma as never,
      new BasicPriceEligibilityPolicy(),
      ws,
      new Date('2026-10-10T00:00:00Z'),
      {},
    );
    expect(excluded).toEqual([]);
  });

  it('BP-ONE-TRUTH-01 — unknown KDN stays unknown; conflicting known KDN never consolidates', async () => {
    const { prisma } = await setup();
    const earlier = {
      id: ancestorId,
      docKey: 'one-exact-source-cell',
      amount: '150000',
      kdnPercent: '100.00',
      effectiveDate: new Date('2026-08-26T00:00:00Z'),
    };
    const later = {
      id: '44444444-4444-4444-8444-444444444444',
      docKey: 'one-exact-source-cell',
      amount: '150000',
      kdnPercent: null,
      effectiveDate: new Date('2026-09-02T00:00:00Z'),
    };
    const runWithKdn = async (reported: string | null) => {
      prisma.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([earlier, { ...later, kdnPercent: reported }]);
      prisma.basicPrice.findMany
        .mockReset()
        .mockResolvedValueOnce([{ id: earlier.id }, { id: later.id }]);
      return BasicPriceService.olderSameSourceObservationOfferIds(
        prisma as never,
        new BasicPriceEligibilityPolicy(),
        ws,
        new Date('2026-10-10T00:00:00Z'),
        {},
      );
    };
    // Price may be deduplicated, but never populate the newer UNKNOWN KDN.
    expect(await runWithKdn(null)).toEqual([ancestorId]);
    expect(later.kdnPercent).toBeNull();
    // Two explicit different percentages represent a real unresolved conflict.
    expect(await runWithKdn('50.00')).toEqual([]);
  });

  it('recognizes only explicitly recorded same-source NEW_OBSERVATION links', () => {
    expect(sameSourceObservationPredecessorId(provenance(middleId)[0])).toBe(
      middleId,
    );
    expect(
      sameSourceObservationPredecessorId(provenance(middleId, false)[0]),
    ).toBeNull();
    expect(
      sameSourceObservationPredecessorId({
        before: {
          semantic: 'NEW_OBSERVATION',
          observedAfterBasicPriceId: middleId,
        },
        after: { semantic: 'CORRECTION', sameSourceIdentity: true },
      }),
    ).toBeNull();
    expect(
      sameSourceObservationPredecessorId({
        before: {
          semantic: 'NEW_OBSERVATION',
          observedAfterBasicPriceId: 'not-a-uuid',
        },
        after: { semantic: 'NEW_OBSERVATION', sameSourceIdentity: true },
      }),
    ).toBeNull();
  });

  it('restores Tim Simprok through two real audit links without altering the latest price', async () => {
    const { service, prisma } = await setup([latest], [middle], [ancestor]);
    const result = await service.findAllForWorkspace(ws);
    expect(result.meta.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      basicPriceId: latestId,
      price: '167500.00',
      sourceName: 'Tim Simprok',
    });
    expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(3);
    for (const rawCall of prisma.basicPrice.findMany.mock.calls.slice(1)) {
      const [args] = rawCall as [{ where: unknown }];
      expect(args.where).toMatchObject({
        workspaceId: ws,
        assetScope: 'WORKSPACE_PRIVATE',
      });
    }
  });

  it('refuses cross-workspace source identity, even when its id is linked', async () => {
    const { service } = await setup(
      [latest],
      [
        {
          ...middle,
          workspaceId: 'other-workspace',
          sourceImportRow: ancestor.sourceImportRow,
        },
      ],
    );
    const result = await service.findAllForWorkspace(ws);
    expect(result.data[0].sourceName).toBeNull();
  });

  it('refuses same display source on a different resource', async () => {
    const { service } = await setup(
      [latest],
      [
        {
          ...middle,
          resource: { ...base.resource, id: 'other-resource' },
          sourceImportRow: ancestor.sourceImportRow,
        },
      ],
    );
    expect(
      (await service.findAllForWorkspace(ws)).data[0].sourceName,
    ).toBeNull();
  });

  it('does not follow different-source observations', async () => {
    const { service, prisma } = await setup([
      { ...latest, provenanceCorrections: provenance(middleId, false) },
    ]);
    expect(
      (await service.findAllForWorkspace(ws)).data[0].sourceName,
    ).toBeNull();
    expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(1);
  });

  it('uses the same source identity on Detail while preserving price and evidence', async () => {
    const { service, prisma } = await setup([middle], [ancestor], []);
    prisma.basicPrice.findFirst.mockResolvedValueOnce({
      ...latest,
      resourceId: base.resource.id,
      regionId: base.region.id,
      supersedesBasicPriceId: null,
      supersedes: null,
      kdnPercent: null,
      kdnEstablishment: null,
    });
    const detail = await service.findDetailForWorkspace(latestId, ws);
    expect(detail.price).toMatchObject({
      basicPriceId: latestId,
      price: '167500.00',
      sourceName: 'Tim Simprok',
    });
    expect(detail.evidence.importBatchLinked).toBe(false);
  });

  it('does not inherit names through cycles', async () => {
    const { service, prisma } = await setup(
      [latest],
      [{ ...middle, provenanceCorrections: provenance(latestId) }],
      [latest],
    );
    expect(
      (await service.findAllForWorkspace(ws)).data[0].sourceName,
    ).toBeNull();
    expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(2);
  });
});

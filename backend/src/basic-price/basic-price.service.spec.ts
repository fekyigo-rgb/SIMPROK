import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PriceVerificationStatus } from '@prisma/client';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceService', () => {
  let service: BasicPriceService;
  let prisma: {
    basicPrice: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  const workspaceId = 'ws-golden-path-01';

  /**
   * RM-03C: the eligibility where-clause is now a two-branch OR, so the old
   * flat `{status, verificationStatus, OR: [tenant]}` shape no longer exists
   * to assert against. The assertions below are RESTATED, never deleted:
   * every original intent is checked explicitly and branch by branch, which
   * is stricter than the flat object equality it replaces.
   *
   *   branch 0 — SIMPROK catalog: unchanged publication predicate
   *              (status PUBLISHED + verificationStatus PUBLISHED) with the
   *              unchanged `this workspace OR global` tenant clause.
   *   branch 1 — this workspace's own private assets: assetScope
   *              WORKSPACE_PRIVATE, matched on STRICT workspaceId equality.
   */
  const eligibilityBranchesOf = (where: any) => {
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toHaveLength(2);
    return { catalog: where.OR[0], priv: where.OR[1] };
  };

  const expectTwoBranchEligibility = (where: any) => {
    const { catalog, priv } = eligibilityBranchesOf(where);

    // Catalog branch — byte-for-byte the pre-RM-03C public predicate.
    expect(catalog.status).toBe('PUBLISHED');
    expect(catalog.verificationStatus).toBe(PriceVerificationStatus.PUBLISHED);
    expect(catalog.OR).toEqual([{ workspaceId }, { workspaceId: null }]);
    // Publication must never be widened by an ownership condition.
    expect(catalog).not.toHaveProperty('assetScope');

    // Private branch — strict ownership. Never null, never an OR, and never
    // reachable by claiming publication.
    expect(priv.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(priv.workspaceId).toBe(workspaceId);
    expect(priv).not.toHaveProperty('OR');
    expect(priv.verificationStatus).toEqual({ not: 'REJECTED' });
    expect(JSON.stringify(priv)).not.toContain('"workspaceId":null');
  };

  // Public-eligible record: lifecycle PUBLISHED + verification terminal PUBLISHED.
  const mockPrice = {
    id: 'bp-01',
    resourceId: 'rc-01',
    workspaceId,
    value: '150000.00',
    effectiveDate: new Date('2026-01-01'),
    status: 'PUBLISHED',
    sourceOrigin: 'GOVERNMENT',
    sourceType: 'MARKET_SURVEY',
    verificationStatus: 'PUBLISHED',
    freshnessStatus: 'CURRENT',
    resource: {
      id: 'rc-01',
      code: 'MAT-SEMEN-01',
      name: 'Semen Portland 50kg',
      type: 'MATERIAL',
      baseUnit: 'Zak',
    },
  };

  beforeEach(async () => {
    prisma = {
      basicPrice: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceService,
        BasicPriceEligibilityPolicy,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BasicPriceService>(BasicPriceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForWorkspace — public eligibility hard lock', () => {
    it('base where enforces the catalog publication predicate and this workspace own private assets', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId);

      expectTwoBranchEligibility(
        prisma.basicPrice.findMany.mock.calls[0][0].where,
      );
      // count uses the SAME eligibility where → meta.total can never count a
      // row the page itself would not have shown.
      expectTwoBranchEligibility(prisma.basicPrice.count.mock.calls[0][0].where);
      expect(prisma.basicPrice.count.mock.calls[0][0].where).toEqual(
        prisma.basicPrice.findMany.mock.calls[0][0].where,
      );
    });

    it('returns an explicit Explorer projection (never the raw entity) with pagination meta', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data).toEqual([
        {
          basicPriceId: 'bp-01',
          resource: {
            id: 'rc-01',
            code: 'MAT-SEMEN-01',
            name: 'Semen Portland 50kg',
            type: 'MATERIAL',
            baseUnit: 'Zak',
          },
          region: null,
          price: '150000.00',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          validUntil: null,
          sourceType: 'MARKET_SURVEY',
          sourceOrigin: 'GOVERNMENT',
          sourceName: null,
          freshnessStatus: 'CURRENT',
          workspaceScope: 'WORKSPACE',
          // RM-03C: which asset family this row belongs to, stated rather than
          // left for the reader to guess from workspaceScope (a curated
          // catalog price can be workspace-scoped too).
          assetScope: 'SIMPROK_CATALOG',
        },
      ]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      // No raw Prisma column (status/verificationStatus/resourceId/workspaceId) leaks through.
      expect(result.data[0]).not.toHaveProperty('status');
      expect(result.data[0]).not.toHaveProperty('verificationStatus');
      expect(result.data[0]).not.toHaveProperty('workspaceId');
    });

    it('projects a global row (workspaceId=null) as workspaceScope=GLOBAL', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([
        { ...mockPrice, workspaceId: null },
      ]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data[0].workspaceScope).toBe('GLOBAL');
    });

    it('derives sourceName from the real import-batch provenance chain when present', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([
        {
          ...mockPrice,
          sourceSubmission: {
            importRow: {
              batch: {
                sourceOrganizationName: 'Dinas PU',
                sourceVendorName: 'Toko Jaya',
              },
            },
          },
        },
      ]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data[0].sourceName).toBe('Toko Jaya');
    });

    it('sourceName is null (never fabricated) when the provenance chain is absent', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([
        { ...mockPrice, sourceSubmission: null },
      ]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data[0].sourceName).toBeNull();
    });

    it('projects a human-readable region when the row has one', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([
        {
          ...mockPrice,
          region: { id: 'reg-01', code: 'DKI', name: 'DKI Jakarta' },
        },
      ]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data[0].region).toEqual({
        id: 'reg-01',
        code: 'DKI',
        name: 'DKI Jakarta',
      });
    });

    it('accepts verificationStatus=PUBLISHED query without widening eligibility', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await expect(
        service.findAllForWorkspace(workspaceId, {
          verificationStatus: PriceVerificationStatus.PUBLISHED,
        }),
      ).resolves.toBeDefined();

      // The accepted query param changes NOTHING: the where-clause is exactly
      // the one produced with no filter at all. It cannot widen either branch,
      // and it does not narrow them either — it is validated, then ignored.
      const where = prisma.basicPrice.findMany.mock.calls[0][0].where;
      expectTwoBranchEligibility(where);
      expect(where).not.toHaveProperty('verificationStatus');
    });

    it.each([
      PriceVerificationStatus.VERIFIED,
      PriceVerificationStatus.UNVERIFIED,
      PriceVerificationStatus.SUBMITTED,
      PriceVerificationStatus.UNDER_REVIEW,
      PriceVerificationStatus.REJECTED,
    ])(
      'rejects internal-curation verificationStatus=%s with BadRequest (defensive, not only DTO)',
      async (status) => {
        await expect(
          service.findAllForWorkspace(workspaceId, {
            verificationStatus: status,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
      },
    );

    it('applies search within tenant/global visibility (does not drop eligibility)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { search: 'Semen' });

      expectTwoBranchEligibility(
        prisma.basicPrice.findMany.mock.calls[0][0].where,
      );
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: {
              OR: [{ workspaceId }, { workspaceId: null }],
              AND: [
                {
                  OR: [
                    { code: { contains: 'Semen', mode: 'insensitive' } },
                    { name: { contains: 'Semen', mode: 'insensitive' } },
                  ],
                },
              ],
            },
          }),
        }),
      );
    });

    it('applies non-verification filters correctly alongside eligibility', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceOrigin: 'GOVERNMENT',
        freshnessStatus: 'EXPIRED',
        year: 2026,
        regionId: 'reg-01',
        resourceId: 'rc-01',
      });

      expectTwoBranchEligibility(
        prisma.basicPrice.findMany.mock.calls[0][0].where,
      );
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceOrigin: 'GOVERNMENT',
            freshnessStatus: 'EXPIRED',
            regionId: 'reg-01',
            resourceId: 'rc-01',
            effectiveDate: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lte: new Date('2026-12-31T23:59:59.999Z'),
            },
          }),
        }),
      );
    });

    it('applies resourceType (category) filter using the canonical ResourceCatalog.type field', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        resourceType: 'LABOR',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: expect.objectContaining({ type: 'LABOR' }),
          }),
        }),
      );
    });

    it('sourceFamily=STORE_SUPPLIER maps to sourceOrigin IN [SUPPLIER, STORE, DISTRIBUTOR]', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceFamily: 'STORE_SUPPLIER',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceOrigin: { in: ['SUPPLIER', 'STORE', 'DISTRIBUTOR'] },
          }),
        }),
      );
    });

    it('sourceFamily=GOVERNMENT maps to the single exact sourceOrigin GOVERNMENT (not wrapped in `in`)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceFamily: 'GOVERNMENT',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceOrigin: 'GOVERNMENT' }),
        }),
      );
    });

    it('sourceFamily=FIELD_PRICE maps to sourceOrigin IN [FIELD_REPORT, COMMUNITY_REPORT]', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceFamily: 'FIELD_PRICE',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceOrigin: { in: ['FIELD_REPORT', 'COMMUNITY_REPORT'] },
          }),
        }),
      );
    });

    it('an exact sourceOrigin outside the requested sourceFamily narrows to an empty, never-matching set (fail-closed intersection, not widened)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([]);
      prisma.basicPrice.count.mockResolvedValue(0);

      await service.findAllForWorkspace(workspaceId, {
        sourceFamily: 'GOVERNMENT',
        sourceOrigin: 'STORE',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceOrigin: { in: [] } }),
        }),
      );
    });

    it('backward compatibility: exact sourceOrigin alone (no sourceFamily) keeps working unchanged', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceOrigin: 'DISTRIBUTOR',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceOrigin: 'DISTRIBUTOR' }),
        }),
      );
    });

    it('applies dateFrom inclusive and dateTo exclusive-next-day (final day fully included)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveDate: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lt: new Date('2026-07-01T00:00:00.000Z'),
            },
          }),
        }),
      );
    });

    it('dateTo month rollover: 2026-04-30 excludes at 2026-05-01, not before', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { dateTo: '2026-04-30' });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveDate: { lt: new Date('2026-05-01T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('dateTo year rollover: 2026-12-31 excludes at 2027-01-01, not before', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { dateTo: '2026-12-31' });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveDate: { lt: new Date('2027-01-01T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('accepts a valid leap day as both dateFrom and dateTo', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        dateFrom: '2024-02-29',
        dateTo: '2024-02-29',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveDate: {
              gte: new Date('2024-02-29T00:00:00.000Z'),
              lt: new Date('2024-03-01T00:00:00.000Z'),
            },
          }),
        }),
      );
    });

    it('rejects a non-leap-year Feb 29 (400, never silently rolled to Mar 1)', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, { dateTo: '2026-02-29' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('rejects a calendar-invalid date (400, never silently rolled forward)', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, { dateFrom: '2026-02-30' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('rejects a timestamp in a date-only field (400)', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, {
          dateFrom: '2026-06-30T10:00:00Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('applies sourceName as a real-provenance-chain filter (never fabricated)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sourceName: 'Toko Jaya',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceSubmission: {
              is: {
                importRow: {
                  is: {
                    batch: {
                      is: {
                        OR: [
                          {
                            sourceVendorName: {
                              contains: 'Toko Jaya',
                              mode: 'insensitive',
                            },
                          },
                          {
                            sourceOrganizationName: {
                              contains: 'Toko Jaya',
                              mode: 'insensitive',
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );
    });

    it('rejects year combined with dateFrom/dateTo as an ambiguous time filter (400)', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, {
          year: 2026,
          dateFrom: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('rejects dateFrom after dateTo (400)', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, {
          dateFrom: '2026-06-30',
          dateTo: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it.each(['dateFrom', 'dateTo'] as const)(
      'rejects an ISO8601 "basic format" %s (no separators) — not this date-only contract\'s exact YYYY-MM-DD format (400)',
      async (field) => {
        await expect(
          service.findAllForWorkspace(workspaceId, { [field]: '20260615' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
      },
    );

    it('applies combinations of search + unit + tenant scope properly', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        search: 'Semen',
        unit: 'Zak',
      });

      expectTwoBranchEligibility(
        prisma.basicPrice.findMany.mock.calls[0][0].where,
      );
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: {
              OR: [{ workspaceId }, { workspaceId: null }],
              baseUnit: 'Zak',
              AND: [
                {
                  OR: [
                    { code: { contains: 'Semen', mode: 'insensitive' } },
                    { name: { contains: 'Semen', mode: 'insensitive' } },
                  ],
                },
              ],
            },
          }),
        }),
      );
    });

    it('enforces pagination skip/take', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { page: 2, limit: 50 });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 50 }),
      );
    });

    it('applies deterministic sorting with id tie-breaker', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sortBy: 'effectiveDate',
        sortOrder: 'desc',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }],
        }),
      );
    });
  });

  describe('findOneForWorkspace — eligibility hard lock', () => {
    it('where enforces the catalog publication predicate and this workspace own private assets', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(mockPrice);

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result).toEqual(mockPrice);
      expectTwoBranchEligibility(
        prisma.basicPrice.findFirst.mock.calls[0][0].where,
      );
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'bp-01' }),
        }),
      );
    });

    it('returns eligible global price', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...mockPrice,
        workspaceId: null,
      });

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result.workspaceId).toBeNull();
    });

    it('throws NotFound for internal-curation record (filtered by eligibility where → null)', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForWorkspace('bp-internal', workspaceId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for cross-tenant record', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForWorkspace('bp-other', 'ws-attacker'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByResource — eligibility hard lock', () => {
    it('where enforces the catalog publication predicate and this workspace own private assets', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);

      const result = await service.findByResource('rc-01', workspaceId);

      expect(result).toEqual([mockPrice]);
      const where = prisma.basicPrice.findMany.mock.calls[0][0].where;
      expectTwoBranchEligibility(where);
      expect(where.resourceId).toBe('rc-01');
      // Exactly two keys: the resource filter and the eligibility OR. Nothing
      // else silently narrows or widens this read.
      expect(Object.keys(where).sort()).toEqual(['OR', 'resourceId']);
    });

    it('keeps its pre-existing display order and does NOT rank by assetScope', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);

      await service.findByResource('rc-01', workspaceId);

      // PRE-EXISTING order, unchanged by RM-03C. Private-vs-catalog precedence
      // is an OPEN OWNER DECISION: this read must not quietly become the place
      // where it gets answered.
      const orderBy = prisma.basicPrice.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual([
        { workspaceId: 'desc' },
        { effectiveDate: 'desc' },
      ]);
      expect(JSON.stringify(orderBy)).not.toContain('assetScope');
    });
  });

  describe('healthCheck', () => {
    it('returns module status', () => {
      expect(service.healthCheck()).toEqual({
        module: 'basic-price',
        status: 'ok',
      });
    });
  });
});

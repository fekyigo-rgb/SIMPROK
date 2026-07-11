import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PriceVerificationStatus } from '@prisma/client';
import { BasicPriceService } from './basic-price.service';
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
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BasicPriceService>(BasicPriceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForWorkspace — public eligibility hard lock', () => {
    it('base where always enforces status=PUBLISHED, verificationStatus=PUBLISHED, and tenant/global', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId);

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
            OR: [{ workspaceId }, { workspaceId: null }],
          }),
        }),
      );
      // count uses the same eligibility where → meta.total only counts eligible
      expect(prisma.basicPrice.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
          }),
        }),
      );
    });

    it('returns basic prices with pagination meta', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data).toEqual([mockPrice]);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('accepts verificationStatus=PUBLISHED query without widening eligibility', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await expect(
        service.findAllForWorkspace(workspaceId, {
          verificationStatus: PriceVerificationStatus.PUBLISHED,
        }),
      ).resolves.toBeDefined();

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            verificationStatus: PriceVerificationStatus.PUBLISHED,
          }),
        }),
      );
    });

    it.each([
      PriceVerificationStatus.VERIFIED,
      PriceVerificationStatus.UNVERIFIED,
      PriceVerificationStatus.SUBMITTED,
      PriceVerificationStatus.UNDER_REVIEW,
      PriceVerificationStatus.REJECTED,
    ])('rejects internal-curation verificationStatus=%s with BadRequest (defensive, not only DTO)', async (status) => {
      await expect(
        service.findAllForWorkspace(workspaceId, { verificationStatus: status }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('applies search within tenant/global visibility (does not drop eligibility)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { search: 'Semen' });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
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
        sourceOrigin: 'GOVERNMENT' as any,
        freshnessStatus: 'EXPIRED' as any,
        year: 2026,
        regionId: 'reg-01',
        resourceId: 'rc-01',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
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

    it('applies combinations of search + unit + tenant scope properly', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { search: 'Semen', unit: 'Zak' });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ workspaceId }, { workspaceId: null }],
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
    it('where enforces status=PUBLISHED, verificationStatus=PUBLISHED, tenant/global', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(mockPrice);

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result).toEqual(mockPrice);
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bp-01',
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
            OR: [{ workspaceId }, { workspaceId: null }],
          }),
        }),
      );
    });

    it('returns eligible global price', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({ ...mockPrice, workspaceId: null });

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
    it('where enforces status=PUBLISHED, verificationStatus=PUBLISHED, tenant/global', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);

      const result = await service.findByResource('rc-01', workspaceId);

      expect(result).toEqual([mockPrice]);
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceId: 'rc-01',
            status: 'PUBLISHED',
            verificationStatus: PriceVerificationStatus.PUBLISHED,
            OR: [{ workspaceId }, { workspaceId: null }],
          },
        }),
      );
    });
  });

  describe('healthCheck', () => {
    it('returns module status', () => {
      expect(service.healthCheck()).toEqual({ module: 'basic-price', status: 'ok' });
    });
  });
});

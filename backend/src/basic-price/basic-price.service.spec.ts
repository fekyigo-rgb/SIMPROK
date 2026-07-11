import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

  const mockPrice = {
    id: 'bp-01',
    resourceId: 'rc-01',
    workspaceId,
    value: '150000.00',
    effectiveDate: new Date('2026-01-01'),
    status: 'PUBLISHED',
    sourceOrigin: 'SURVEY',
    sourceType: 'MARKET_SURVEY',
    verificationStatus: 'VERIFIED',
    freshnessStatus: 'FRESH',
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

  describe('findAllForWorkspace', () => {
    it('returns basic prices scoped to workspace and global with pagination', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result.data).toEqual([mockPrice]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('applies search match correctly for resource code and name within tenant/global visibility', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, { search: 'Semen' });

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

    it('applies search mismatch safely (empty array)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([]);
      prisma.basicPrice.count.mockResolvedValue(0);

      const result = await service.findAllForWorkspace(workspaceId, { search: 'NonExistent' });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('applies individual filters correctly', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      // Testing sourceOrigin, verificationStatus, freshnessStatus, year, regionId, resourceId
      await service.findAllForWorkspace(workspaceId, {
        sourceOrigin: 'SURVEY' as any,
        verificationStatus: 'VERIFIED' as any,
        freshnessStatus: 'FRESH' as any,
        year: 2026,
        regionId: 'reg-01',
        resourceId: 'rc-01',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceOrigin: 'SURVEY',
            verificationStatus: 'VERIFIED',
            freshnessStatus: 'FRESH',
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

      await service.findAllForWorkspace(workspaceId, {
        search: 'Semen',
        unit: 'Zak',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ workspaceId }, { workspaceId: null }], // Tenant scope on basicPrice
            resource: {
              OR: [{ workspaceId }, { workspaceId: null }], // Tenant scope on resource
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

    it('enforces pagination and maximum limit gracefully', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      // We test the logic that passes pagination values to Prisma skip/take.
      // Note: The limit max 50 is enforced at DTO validation layer,
      // but we test if the service handles the injected limit properly.
      await service.findAllForWorkspace(workspaceId, {
        page: 2,
        limit: 50,
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 50,
          take: 50,
        }),
      );
    });

    it('applies deterministic sorting using effectiveDate and tie-breaker id', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);

      await service.findAllForWorkspace(workspaceId, {
        sortBy: 'effectiveDate',
        sortOrder: 'desc',
      });

      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { effectiveDate: 'desc' },
            { id: 'asc' },
          ],
        }),
      );
    });
  });

  describe('findOneForWorkspace', () => {
    it('returns a price when found in workspace scope (Tenant visibility)', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(mockPrice);

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result).toEqual(mockPrice);
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bp-01',
            status: 'PUBLISHED',
            OR: [{ workspaceId }, { workspaceId: null }],
          }),
        }),
      );
    });

    it('returns global price properly', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({ ...mockPrice, workspaceId: null });

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result.workspaceId).toBeNull();
    });

    it('throws NotFoundException when price is outside workspace scope (Cross-tenant)', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForWorkspace('bp-other', 'ws-attacker'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByResource', () => {
    it('returns prices for a resource scoped to workspace or global', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);

      const result = await service.findByResource('rc-01', workspaceId);

      expect(result).toEqual([mockPrice]);
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceId: 'rc-01',
            status: 'PUBLISHED',
            OR: [
              { workspaceId },
              { workspaceId: null },
            ],
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

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceService', () => {
  let service: BasicPriceService;
  let prisma: {
    basicPrice: {
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
    sourceType: 'MARKET_SURVEY',
    verificationStatus: 'VERIFIED',
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
    it('returns basic prices scoped to workspace and global (null workspace)', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);

      const result = await service.findAllForWorkspace(workspaceId);

      expect(result).toEqual([mockPrice]);
      expect(prisma.basicPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PUBLISHED',
            OR: [
              { workspaceId },
              { workspaceId: null },
            ],
          },
        }),
      );
    });

    it('returns empty array when no prices exist for workspace', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const result = await service.findAllForWorkspace('ws-empty');

      expect(result).toEqual([]);
    });
  });

  describe('findOneForWorkspace', () => {
    it('returns a price when found in workspace scope', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(mockPrice);

      const result = await service.findOneForWorkspace('bp-01', workspaceId);

      expect(result).toEqual(mockPrice);
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bp-01',
            status: 'PUBLISHED',
          }),
        }),
      );
    });

    it('throws NotFoundException when price is outside workspace scope', async () => {
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

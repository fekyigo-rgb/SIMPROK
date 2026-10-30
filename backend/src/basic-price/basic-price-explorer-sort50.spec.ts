import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';

describe('BP-EXPLORER-SORT50: server-side ordering before 50-row pagination', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    basicPrice: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new BasicPriceService(prisma as never, new BasicPriceEligibilityPolicy());
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.basicPrice.count.mockResolvedValue(0);
    prisma.basicPrice.findMany.mockResolvedValue([]);
  });

  it.each([
    ['effectiveDate', 'desc', { effectiveDate: 'desc' }],
    ['effectiveDate', 'asc', { effectiveDate: 'asc' }],
    ['resourceName', 'asc', { resource: { name: 'asc' } }],
    ['resourceName', 'desc', { resource: { name: 'desc' } }],
    ['price', 'asc', { value: 'asc' }],
    ['price', 'desc', { value: 'desc' }],
  ] as const)('%s %s uses canonical Prisma ordering and stable id', async (sortBy, sortOrder, first) => {
    await service.findAllForWorkspace(workspaceId, { sortBy, sortOrder, limit: 50, page: 2 });
    const args = prisma.basicPrice.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([first, { id: 'asc' }]);
    expect(args.skip).toBe(50);
    expect(args.take).toBe(50);
    expect(args.where).toEqual(prisma.basicPrice.count.mock.calls[0][0].where);
    expect(args.where.OR).toEqual(new BasicPriceEligibilityPolicy().usableWhere(workspaceId).OR);
  });

  it('keeps old date-descending default and original API default page size', async () => {
    await service.findAllForWorkspace(workspaceId, {});
    expect(prisma.basicPrice.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ effectiveDate: 'desc' }, { id: 'asc' }]);
    expect(prisma.basicPrice.findMany.mock.calls[0][0].take).toBe(20);
  });

  it('whitelists new sort keys and retains upper bound of 50', async () => {
    for (const sortBy of ['effectiveDate', 'createdAt', 'updatedAt', 'resourceName', 'price']) {
      expect(await validate(Object.assign(new GetBasicPricesDto(), { sortBy }))).toEqual([]);
    }
    const invalid = Object.assign(new GetBasicPricesDto(), { sortBy: 'sourceUnproven', limit: 51 });
    const errors = await validate(invalid);
    expect(errors.some(e => e.property === 'sortBy')).toBe(true);
    expect(errors.some(e => e.property === 'limit')).toBe(true);
  });
});

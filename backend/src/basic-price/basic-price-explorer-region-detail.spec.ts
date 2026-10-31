import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';

describe('BP-REGION-DETAIL: canonical parent chain in existing Explorer', () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    basicPrice: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new BasicPriceService(prisma as never, new BasicPriceEligibilityPolicy());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.basicPrice.count.mockResolvedValue(0);
    prisma.basicPrice.findMany.mockResolvedValue([]);
  });

  it('selects existing Region ancestry without mutating historical price data', async () => {
    await service.findAllForWorkspace('20000000-0000-4000-8000-000000000001', {
      page: 1, limit: 50, sortBy: 'resourceName', sortOrder: 'asc',
    });
    const args = prisma.basicPrice.findMany.mock.calls[0][0];
    const region = args.select.region.select;
    expect(region.id).toBe(true);
    expect(region.name).toBe(true);
    expect(region.administrativeLevel).toBe(true);
    expect(region.parent.select.administrativeLevel).toBe(true);
    expect(region.parent.select.parent.select.administrativeLevel).toBe(true);
    expect(region.parent.select.parent.select.parent.select.administrativeLevel).toBe(true);
    expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(1);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual([{ resource: { name: 'asc' } }, { id: 'asc' }]);
  });
});

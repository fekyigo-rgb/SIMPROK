import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';

describe('BP-REGION-DETAIL: canonical parent chain in existing Explorer', () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    basicPrice: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new BasicPriceService(prisma as never, new BasicPriceEligibilityPolicy());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.basicPrice.count.mockResolvedValue(0);
    prisma.basicPrice.findFirst.mockResolvedValue(null);
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
  it('P1 selects immutable member names on Detail only, not the Explorer list', async () => {
    await expect(service.findDetailForWorkspace(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
    )).rejects.toThrow('BasicPrice not found');
    const detailArgs = prisma.basicPrice.findFirst.mock.calls[0][0];
    const members = detailArgs.select.regionCoverageSet.select.members;
    expect(members.orderBy).toEqual({ regionId: 'asc' });
    expect(members.select.region.select.name).toBe(true);
    expect(members.select.region.select.administrativeLevel).toBe(true);
    expect(members.select.regionId).toBe(true);
    await service.findAllForWorkspace('20000000-0000-4000-8000-000000000001', {
      page: 1, limit: 50, sortBy: 'resourceName', sortOrder: 'asc',
    });
    const listMembers = prisma.basicPrice.findMany.mock.calls[0][0].select.regionCoverageSet.select.members;
    expect(listMembers.select).toEqual({ regionId: true });
  });
});

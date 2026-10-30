import { validate } from 'class-validator';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { BasicPriceService } from './basic-price.service';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';

describe('BP-EXPLORER-UI-03 — scoped collection filter', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const prisma = {
    $queryRaw: jest.fn(),
    basicPrice: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const policy = new BasicPriceEligibilityPolicy();
  const service = new BasicPriceService(prisma as never, policy as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.basicPrice.count.mockResolvedValue(0);
    prisma.basicPrice.findMany.mockResolvedValue([]);
  });

  const queries = async (assetScope?: 'WORKSPACE_PRIVATE' | 'SIMPROK_CATALOG') => {
    await service.findAllForWorkspace(workspaceId, { assetScope });
    const countWhere = prisma.basicPrice.count.mock.calls[0][0].where;
    const listWhere = prisma.basicPrice.findMany.mock.calls[0][0].where;
    expect(countWhere).toEqual(listWhere);
    expect(countWhere.OR).toEqual(policy.usableWhere(workspaceId).OR);
    expect(countWhere.AND).toBeDefined();
    return countWhere;
  };

  it('keeps the existing combined catalog and current-workspace private eligible list as default', async () => {
    const where = await queries();
    expect(where).not.toHaveProperty('assetScope');
  });

  it.each(['WORKSPACE_PRIVATE', 'SIMPROK_CATALOG'] as const)(
    'narrows both paginated count and list to %s, never alters eligibility branches',
    async (scope) => {
      const where = await queries(scope);
      expect(where.assetScope).toBe(scope);
      expect(where.OR).toEqual(policy.usableWhere(workspaceId).OR);
      const privateBranch = where.OR.find((candidate: { assetScope?: string }) => candidate.assetScope === 'WORKSPACE_PRIVATE');
      expect(privateBranch.workspaceId).toBe(workspaceId);
    },
  );

  it('rejects invalid scope even if DTO validation was skipped', async () => {
    await expect(service.findAllForWorkspace(workspaceId, {
      assetScope: 'FOREIGN_SCOPE' as 'WORKSPACE_PRIVATE',
    })).rejects.toThrow('Invalid Basic Price assetScope filter');
    expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
  });

  it('validates the parameter against the two approved scope values', async () => {
    for (const value of ['WORKSPACE_PRIVATE', 'SIMPROK_CATALOG', undefined]) {
      const dto = Object.assign(new GetBasicPricesDto(), { assetScope: value });
      expect(await validate(dto)).toEqual([]);
    }
    const dto = Object.assign(new GetBasicPricesDto(), { assetScope: 'OTHER' });
    expect((await validate(dto)).some((v) => v.property === 'assetScope')).toBe(true);
  });
});

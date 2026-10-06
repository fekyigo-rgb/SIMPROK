import { BasicPricePromotionService } from './basic-price-promotion.service';

describe('BasicPricePromotionService Region coverage propagation', () => {
  it('copies the immutable coverage reference when it copies scalar Region context', async () => {
    const source = {
      resourceId: 'resource-01',
      regionId: 'district-01',
      regionCoverageSetId: 'coverage-01',
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      sourcePeriodLabel: null,
      sourcePeriodGranularity: null,
      effectiveDateProvenance: null,
      effectiveDateDerivationRule: null,
      value: '125000.00',
      kdnPercent: null,
      kdnEstablishment: null,
      sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'SUPPLIER',
      freshnessStatus: 'CURRENT',
      reportedByAccountId: 'account-01',
      reviewDate: null,
      validUntil: null,
    };
    const shared = { id: 'shared-01', ...source };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'origin-01',
          assetScope: 'SIMPROK_CATALOG',
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
        },
      ]),
      basicPrice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(source),
        create: jest.fn().mockResolvedValue(shared),
      },
      basicPricePublicationAudit: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm' }) },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-01' }),
      },
      basicPrice: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new BasicPricePromotionService(prisma as never);

    const result = await service.promoteToSharedCatalog({
      workspaceId: 'workspace-01',
      basicPriceId: 'origin-01',
      actorAccountId: 'account-01',
    });

    expect(result.created).toBe(true);
    expect(tx.basicPrice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        regionId: 'district-01',
        regionCoverageSetId: 'coverage-01',
        promotedFromBasicPriceId: 'origin-01',
      }),
    });
  });
});

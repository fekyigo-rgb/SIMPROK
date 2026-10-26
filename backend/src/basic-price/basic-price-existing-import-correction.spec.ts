import { Prisma } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

/** Two import-root prices, one governed correction link: no third BasicPrice. */
describe('BP-C2 owner-corrected existing imported price linkage', () => {
  const actor = {
    workspaceId: '20000000-0000-4000-8000-000000000001',
    accountId: '40000000-0000-4000-8000-000000000001',
    userId: '50000000-0000-4000-8000-000000000001',
  };
  const previousPriceId = '60000000-0000-4000-8000-000000000001';
  const correctedPriceId = '60000000-0000-4000-8000-000000000002';
  const batch = {
    uploadedByAccountId: actor.accountId,
    sourceOrganizationName: 'Tim Simprok',
    sourceVendorName: null,
  };
  const old = () => ({
    id: previousPriceId, workspaceId: actor.workspaceId,
    organizationId: '21000000-0000-4000-8000-000000000001',
    resourceId: '70000000-0000-4000-8000-000000000001',
    regionId: '80000000-0000-4000-8000-000000000001',
    regionCoverageSetId: null, sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'FIELD_REPORT', effectiveDate: new Date('2026-10-01'),
    createdAt: new Date('2026-10-22'), status: 'UNPUBLISHED',
    verificationStatus: 'UNVERIFIED', assetScope: 'WORKSPACE_PRIVATE',
    value: new Prisma.Decimal('12500000.00'), sourceImportRowId: '90000000-0000-4000-8000-000000000001',
    sourceImportRow: { batch }, supersedesBasicPriceId: null, supersededBy: null,
  });
  const newer = () => ({
    ...old(), id: correctedPriceId, value: new Prisma.Decimal('6500000.00'),
    createdAt: new Date('2026-10-26'),
    sourceImportRowId: '90000000-0000-4000-8000-000000000002',
  });
  const args = {
    actor, previousPriceId, correctedPriceId,
    expectedPreviousValue: '12500000.00', expectedCorrectedValue: '6500000.00',
    reason: 'Owner confirms this is a correction of a wrong source price.',
  };
  let tx: any;
  let service: BasicPricePrivateAssetService;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: previousPriceId }, { id: correctedPriceId },
      ]),
      basicPrice: {
        findMany: jest.fn().mockResolvedValue([old(), newer()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      basicPriceProvenanceCorrection: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        findFirst: jest.fn(),
      },
    };
    service = new BasicPricePrivateAssetService({
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(tx)),
    } as any);
  });

  it('links existing successor with exact source provenance and audit; creates zero prices', async () => {
    const result = await service.reconcileImportedPrivateCorrection(args);
    expect(result).toMatchObject({
      basicPriceId: correctedPriceId, previousBasicPriceId: previousPriceId,
      value: '6500000.00', unchanged: false,
    });
    expect(tx.basicPrice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: correctedPriceId, workspaceId: actor.workspaceId,
        supersedesBasicPriceId: null,
      }),
      data: { supersedesBasicPriceId: previousPriceId },
    }));
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        basicPriceId: correctedPriceId, actorAccountId: actor.accountId,
        before: expect.objectContaining({ previousSourceImportRowId: old().sourceImportRowId }),
        after: expect.objectContaining({
          semantic: 'IMPORTED_PRICE_CORRECTION_LINK',
          correctedSourceImportRowId: newer().sourceImportRowId,
        }),
      }),
    }));
  });

  it('refuses different publisher even when resource, date and region look identical', async () => {
    tx.basicPrice.findMany.mockResolvedValue([old(), {
      ...newer(), sourceImportRow: { batch: { ...batch, sourceOrganizationName: 'Other publisher' } },
    }]);
    await expect(service.reconcileImportedPrivateCorrection(args))
      .rejects.toThrow('CORRECTION_PUBLISHER_IDENTITY_UNPROVED');
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('refuses different resource variants even under the same publisher', async () => {
    tx.basicPrice.findMany.mockResolvedValue([old(), {
      ...newer(), resourceId: '70000000-0000-4000-8000-000000000002',
    }]);
    await expect(service.reconcileImportedPrivateCorrection(args))
      .rejects.toThrow('CORRECTION_CONTEXT_MISMATCH');
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('refuses different locality or price applicability dates', async () => {
    tx.basicPrice.findMany.mockResolvedValue([old(), {
      ...newer(), effectiveDate: new Date('2026-11-01'),
    }]);
    await expect(service.reconcileImportedPrivateCorrection(args))
      .rejects.toThrow('CORRECTION_CONTEXT_MISMATCH');
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('never trusts a different importer in the same workspace', async () => {
    tx.basicPrice.findMany.mockResolvedValue([old(), {
      ...newer(), sourceImportRow: { batch: {
        ...batch, uploadedByAccountId: '40000000-0000-4000-8000-000000000002',
      } },
    }]);
    await expect(service.reconcileImportedPrivateCorrection(args))
      .rejects.toThrow('BasicPrice not found');
  });

  it('refuses conflicting price facts, unsafe correction lineage, or same money', async () => {
    await expect(service.reconcileImportedPrivateCorrection({
      ...args, expectedPreviousValue: '10000000',
    })).rejects.toThrow('PRICE_STALE_FACT');
    tx.basicPrice.findMany.mockResolvedValue([{
      ...old(), supersededBy: { id: 'other' },
    }, newer()]);
    await expect(service.reconcileImportedPrivateCorrection(args))
      .rejects.toThrow('CORRECTION_LINEAGE_NOT_SAFE');
    await expect(service.reconcileImportedPrivateCorrection({
      ...args, expectedCorrectedValue: '12500000',
    })).rejects.toThrow('CORRECTION_IDENTICAL_VALUE_NOT_ADJUDICATED');
  });

  it('idempotent on the exact audited link, not by a guessed latest timestamp', async () => {
    tx.basicPrice.findMany.mockResolvedValue([
      { ...old(), supersededBy: { id: correctedPriceId } },
      { ...newer(), supersedesBasicPriceId: previousPriceId },
    ]);
    tx.basicPriceProvenanceCorrection.findFirst.mockResolvedValue({
      after: {
        semantic: 'IMPORTED_PRICE_CORRECTION_LINK',
        previousBasicPriceId: previousPriceId,
      },
    });
    await expect(service.reconcileImportedPrivateCorrection(args))
      .resolves.toMatchObject({ unchanged: true, basicPriceId: correctedPriceId });
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });
});

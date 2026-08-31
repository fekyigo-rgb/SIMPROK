import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BasicPriceAssetScope } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

describe('BP-DETAIL-MAINT-02 catalog missing-KDN enrichment', () => {
  const ACTOR = { accountId: 'acct-1', workspaceId: 'ws-1' };
  let service: BasicPricePrivateAssetService;
  let tx: {
    basicPrice: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    basicPriceProvenanceCorrection: { create: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      basicPrice: {
        findFirst: jest.fn(),
        // OWNER LAW D — the method now reads promotion lineage before it
        // writes. "No descendants" is the ordinary case every law in this
        // file was written for, and remains their subject.
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      basicPriceProvenanceCorrection: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
        Promise.resolve(fn(tx)),
      ),
    };
    service = new BasicPricePrivateAssetService(prisma as never);
  });

  const enrich = (overrides?: {
    canVerify?: boolean;
    canPromoteShared?: boolean;
    kdnPercent?: string;
    expectedKdnPercent?: string | null;
  }) =>
    service.enrichCatalogKdn({
      basicPriceId: 'bp-cat',
      actor: ACTOR,
      kdnPercent: overrides?.kdnPercent ?? '72.5',
      reason: 'kurasi',
      expectedKdnPercent: overrides?.expectedKdnPercent,
      canVerify: overrides?.canVerify ?? true,
      canPromoteShared: overrides?.canPromoteShared ?? false,
    });

  it('workspace catalog + VERIFY fills missing KDN without touching money', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: null,
      kdnEstablishment: null,
    });

    const result = await enrich({ canVerify: true });
    expect(result).toEqual({
      basicPriceId: 'bp-cat',
      kdnPercent: '72.50',
      unchanged: false,
    });
    const update = tx.basicPrice.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toMatchObject({
      id: 'bp-cat',
      assetScope: BasicPriceAssetScope.SIMPROK_CATALOG,
      kdnPercent: null,
    });
    expect(Object.keys(update.data).sort()).toEqual([
      'kdnEstablishment',
      'kdnPercent',
    ]);
    expect(tx.basicPriceProvenanceCorrection.create).toHaveBeenCalledTimes(1);
  });

  it('shared catalog + PROMOTE_SHARED fills missing KDN; VERIFY alone cannot', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-shared',
      workspaceId: null,
      promotedFromBasicPriceId: null,
      kdnPercent: null,
      kdnEstablishment: null,
    });

    await expect(enrich({ canVerify: true, canPromoteShared: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();

    const result = await enrich({ canVerify: false, canPromoteShared: true });
    expect(result.unchanged).toBe(false);
    expect(tx.basicPrice.updateMany).toHaveBeenCalledTimes(1);
  });

  it('ordinary SUBMIT cannot fill catalog KDN even when the row is visible', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: null,
      kdnEstablishment: null,
    });
    await expect(
      enrich({ canVerify: false, canPromoteShared: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('stated catalog KDN is never silently overwritten', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: '72.50',
      kdnEstablishment: 'MANUAL_ENRICHMENT',
    });
    await expect(enrich({ kdnPercent: '40' })).rejects.toMatchObject({
      message: 'KDN_CONFLICT_NO_SILENT_OVERWRITE',
    });
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('DETAIL-CONC catalog — stale expected KDN fails closed', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: '72.50',
      kdnEstablishment: 'MANUAL_ENRICHMENT',
    });
    await expect(
      enrich({ kdnPercent: '40', expectedKdnPercent: null }),
    ).rejects.toMatchObject({ message: 'KDN_STALE_FACT' });
  });

  it('DETAIL-IDEMP catalog — already-applied fill does not write twice', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: '72.50',
      kdnEstablishment: 'MANUAL_ENRICHMENT',
    });
    const result = await enrich({
      kdnPercent: '72.50',
      expectedKdnPercent: null,
    });
    expect(result.unchanged).toBe(true);
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('foreign workspace catalog is indistinguishable from absence', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-other',
      workspaceId: 'ws-other',
      promotedFromBasicPriceId: null,
      kdnPercent: null,
      kdnEstablishment: null,
    });
    await expect(enrich()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('a missing catalog row is NotFound, never a leak', async () => {
    tx.basicPrice.findFirst.mockResolvedValue(null);
    await expect(enrich()).rejects.toBeInstanceOf(NotFoundException);
    const find = tx.basicPrice.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(find.where).toMatchObject({
      id: 'bp-cat',
      assetScope: BasicPriceAssetScope.SIMPROK_CATALOG,
    });
  });

  it('ConflictException still names interpreter refusals', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-cat',
      workspaceId: ACTOR.workspaceId,
      promotedFromBasicPriceId: null,
      kdnPercent: null,
    });
    await expect(enrich({ kdnPercent: '   ' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceAssetScope } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

describe('BP-KDN-01 enrichment and cardinality', () => {
  const ACTOR = { accountId: 'acct-1', workspaceId: 'ws-1' };
  let service: BasicPricePrivateAssetService;
  let prisma: {
    $transaction: jest.Mock;
    basicPrice: { findFirst: jest.Mock; updateMany: jest.Mock };
    basicPriceProvenanceCorrection: { create: jest.Mock };
  };
  let tx: {
    basicPrice: { findFirst: jest.Mock; updateMany: jest.Mock };
    basicPriceProvenanceCorrection: { create: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      basicPrice: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      basicPriceProvenanceCorrection: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
        Promise.resolve(fn(tx)),
      ),
      basicPrice: tx.basicPrice,
      basicPriceProvenanceCorrection: tx.basicPriceProvenanceCorrection,
    };
    service = new BasicPricePrivateAssetService(prisma as never);
  });

  it('KDN-ENR-01 / DETAIL-GOV-01 — a missing KDN may be filled without creating a Basic Price', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: null,
      kdnEstablishment: null,
    });

    const result = await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '72.5',
      reason: 'Sertifikat pabrik 2024',
    });

    expect(result).toEqual({
      basicPriceId: 'bp-1',
      kdnPercent: '72.50',
      unchanged: false,
    });
    expect(tx.basicPrice.updateMany).toHaveBeenCalledTimes(1);
    const updateCalls = tx.basicPrice.updateMany.mock.calls as Array<
      [{ data: { kdnEstablishment?: string; value?: unknown } }]
    >;
    const data = updateCalls[0][0].data;
    expect(data.kdnEstablishment).toBe('MANUAL_ENRICHMENT');
    expect(data.value).toBeUndefined();
    expect(tx.basicPriceProvenanceCorrection.create).toHaveBeenCalledTimes(1);
  });

  it('KDN-ID-01 — same identity + same KDN is idempotent', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: '72.50',
      kdnEstablishment: 'SOURCE_IMPORT_ROW',
    });

    const result = await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '72.50',
      reason: 'ulang',
    });

    expect(result.unchanged).toBe(true);
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });

  it('KDN-ID-02 / KDN-ID-04 / DETAIL-GOV-02 — same identity + different KDN is never latest-wins', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: '72.50',
      kdnEstablishment: 'SOURCE_IMPORT_ROW',
    });

    await expect(
      service.enrichKdn({
        basicPriceId: 'bp-1',
        actor: ACTOR,
        kdnPercent: '40',
        reason: 'angka lain',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('KDN-SEC-02 / DETAIL-CHG-04 — a foreign or catalog price is indistinguishable from absence', async () => {
    tx.basicPrice.findFirst.mockResolvedValue(null);

    await expect(
      service.enrichKdn({
        basicPriceId: 'bp-foreign',
        actor: ACTOR,
        kdnPercent: '72.50',
        reason: 'coba',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const findCalls = tx.basicPrice.findFirst.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    expect(findCalls[0][0].where).toMatchObject({
      id: 'bp-foreign',
      workspaceId: ACTOR.workspaceId,
      assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
    });
  });

  it('KDN-DOM-03 — enrichment never restates money', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '398000.00',
      kdnPercent: null,
      kdnEstablishment: null,
    });
    await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '0',
      reason: 'nol terbukti',
    });
    const updateCalls = tx.basicPrice.updateMany.mock.calls as Array<
      [{ data: Record<string, unknown>; where: Record<string, unknown> }]
    >;
    const data = updateCalls[0][0].data;
    expect(Object.keys(data).sort()).toEqual([
      'kdnEstablishment',
      'kdnPercent',
    ]);
    expect(updateCalls[0][0].where).toMatchObject({ kdnPercent: null });
  });

  it('DETAIL-CONC-01 — a stale expected KDN cannot silently overwrite a newer fact', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: '72.50',
      kdnEstablishment: 'MANUAL_ENRICHMENT',
    });

    await expect(
      service.enrichKdn({
        basicPriceId: 'bp-1',
        actor: ACTOR,
        kdnPercent: '40',
        reason: 'stale form',
        expectedKdnPercent: null,
      }),
    ).rejects.toMatchObject({ message: 'KDN_STALE_FACT' });

    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
  });

  it('DETAIL-IDEMP-01 — retry of an already-applied enrichment does not write twice', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: '72.50',
      kdnEstablishment: 'MANUAL_ENRICHMENT',
    });

    const result = await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '72.50',
      reason: 'retry',
      expectedKdnPercent: null,
    });

    expect(result).toEqual({
      basicPriceId: 'bp-1',
      kdnPercent: '72.50',
      unchanged: true,
    });
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });

  it('DETAIL-TIME-01 — enrichment never restates effectiveDate or money', async () => {
    tx.basicPrice.findFirst.mockResolvedValue({
      id: 'bp-1',
      value: '1000.00',
      kdnPercent: null,
      kdnEstablishment: null,
    });
    await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '72.50',
      reason: 'bukti',
      expectedKdnPercent: null,
    });
    const updateCalls = tx.basicPrice.updateMany.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(Object.keys(updateCalls[0][0].data).sort()).toEqual([
      'kdnEstablishment',
      'kdnPercent',
    ]);
  });

  it('DETAIL-IDEMP-01 concurrent — a lost updateMany is not a second audit', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce({
        id: 'bp-1',
        value: '1000.00',
        kdnPercent: null,
        kdnEstablishment: null,
      })
      .mockResolvedValueOnce({
        id: 'bp-1',
        kdnPercent: '72.50',
      });
    tx.basicPrice.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.enrichKdn({
      basicPriceId: 'bp-1',
      actor: ACTOR,
      kdnPercent: '72.50',
      reason: 'retry',
      expectedKdnPercent: null,
    });

    expect(result.unchanged).toBe(true);
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });
});

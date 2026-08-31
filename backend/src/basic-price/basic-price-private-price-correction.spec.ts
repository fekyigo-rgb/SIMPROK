import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceAssetScope, Prisma } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

describe('BP-DETAIL-MAINT-02 private post-create price correction', () => {
  const ACTOR = { accountId: 'acct-1', workspaceId: 'ws-1' };
  const PREDECESSOR = {
    id: 'bp-old',
    workspaceId: ACTOR.workspaceId,
    organizationId: 'org-1',
    resourceId: 'res-1',
    regionId: 'reg-1',
    effectiveDate: new Date('2026-01-15T00:00:00.000Z'),
    value: '62500.00',
    kdnPercent: '72.50',
    kdnEstablishment: 'SOURCE_IMPORT_ROW',
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'SUPPLIER',
    freshnessStatus: 'CURRENT',
    reviewDate: null,
    validUntil: null,
    sourcePeriodLabel: 'TA 2026',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'YEAR_START',
  };

  let service: BasicPricePrivateAssetService;
  let tx: {
    $queryRaw: jest.Mock;
    basicPrice: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    basicPriceProvenanceCorrection: { create: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: PREDECESSOR.id }]),
      basicPrice: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'bp-new',
          value: new Prisma.Decimal('65000.00'),
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
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

  const correct = (overrides?: {
    expectedValue?: string;
    proposedValue?: string;
    basicPriceId?: string;
  }) =>
    service.correctPrivatePrice({
      basicPriceId: overrides?.basicPriceId ?? PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: overrides?.expectedValue ?? '62500.00',
      proposedValue: overrides?.proposedValue ?? '65000.00',
      reason: 'koreksi angka invoice',
    });

  it('PRIVATE-PRICE-01 — creates a successor and does not update predecessor value', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);

    const result = await correct();
    expect(result).toEqual({
      basicPriceId: 'bp-new',
      value: '65000.00',
      unchanged: false,
    });
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    const data = tx.basicPrice.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.value).toEqual(new Prisma.Decimal('65000.00'));
    expect(data.supersedesBasicPriceId).toBe(PREDECESSOR.id);
    expect(data.sourceImportRowId).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.verificationStatus).toBeUndefined();
    expect(data.kdnPercent).toBe('72.50');
    expect(data.resourceId).toBe(PREDECESSOR.resourceId);
    expect(data.regionId).toBe(PREDECESSOR.regionId);
    expect(data.effectiveDate).toBe(PREDECESSOR.effectiveDate);
    expect(data.assetScope).toBe(BasicPriceAssetScope.WORKSPACE_PRIVATE);
  });

  it('PRIVATE-PRICE-02 — copies identity and KDN; restates only money', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    await correct();
    const data = tx.basicPrice.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.kdnEstablishment).toBe('SOURCE_IMPORT_ROW');
    expect(data.sourceType).toBe('MARKET_SURVEY');
    expect(data.sourceOrigin).toBe('SUPPLIER');
    expect(data.sourcePeriodLabel).toBe('TA 2026');
  });

  it('PRIVATE-PRICE-03 — omits sourceImportRowId so unique evidence stays on the predecessor', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    await correct();
    const data = JSON.stringify(tx.basicPrice.create.mock.calls[0][0].data);
    expect(data).not.toContain('sourceImportRowId');
  });

  it('PRIVATE-PRICE-04 / DETAIL-CONC — stale expected money fails closed', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      value: '70000.00',
    });
    await expect(correct()).rejects.toMatchObject({
      message: 'PRICE_STALE_FACT',
    });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRIVATE-PRICE-05 / DETAIL-IDEMP — existing successor with the same money is unchanged', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce({
        id: 'bp-new',
        value: '65000.00',
      });
    const result = await correct();
    expect(result).toEqual({
      basicPriceId: 'bp-new',
      value: '65000.00',
      unchanged: true,
    });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
    expect(tx.basicPriceProvenanceCorrection.create).not.toHaveBeenCalled();
  });

  it('PRIVATE-PRICE-06 — a different successor money cannot fork the chain', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce({
        id: 'bp-other',
        value: '66000.00',
      });
    await expect(correct()).rejects.toMatchObject({
      message: 'PREDECESSOR_ALREADY_SUPERSEDED',
    });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRIVATE-PRICE-07 — catalog or foreign rows are indistinguishable from absence', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce(null);
    await expect(correct()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
    const lockSql = JSON.stringify(tx.$queryRaw.mock.calls[0][0]);
    expect(lockSql).toContain('FOR UPDATE');
    expect(lockSql).toContain('WORKSPACE_PRIVATE');
  });

  it('PRIVATE-PRICE-08 — proposed equal to expected is refused before any write', async () => {
    await expect(
      correct({ expectedValue: '62500.00', proposedValue: '62500.00' }),
    ).rejects.toMatchObject({ message: 'PRICE_UNCHANGED' });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRIVATE-PRICE-09 — unique successor collision of a different value fails closed', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'bp-race', value: '99999.00' });
    tx.basicPrice.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(correct()).rejects.toMatchObject({
      message: 'PREDECESSOR_ALREADY_SUPERSEDED',
    });
  });

  it('PRIVATE-PRICE-10 — unique successor collision of the same value is idempotent', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'bp-race', value: '65000.00' });
    tx.basicPrice.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await correct();
    expect(result).toEqual({
      basicPriceId: 'bp-race',
      value: '65000.00',
      unchanged: true,
    });
  });

  it('PRIVATE-PRICE concurrent stale expected is ConflictException', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      value: '1.00',
    });
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
  });
});

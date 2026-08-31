import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

function firstCallArg<T>(mock: jest.Mock): T {
  const calls: unknown[][] = mock.mock.calls as unknown[][];
  const first = calls[0];
  if (!Array.isArray(first) || first[0] === undefined) {
    throw new Error('expected a call argument');
  }
  return first[0] as T;
}

describe('BP-CHANGE-SEM-03 new observation ≠ correction', () => {
  const ACTOR = { accountId: 'acct-1', workspaceId: 'ws-1' };
  const MAY = new Date('2026-05-01T00:00:00.000Z');
  const PREDECESSOR = {
    id: 'bp-may',
    workspaceId: ACTOR.workspaceId,
    organizationId: 'org-1',
    resourceId: 'res-1',
    regionId: 'reg-1',
    effectiveDate: MAY,
    value: '62500.00',
    kdnPercent: '72.50',
    kdnEstablishment: 'SOURCE_IMPORT_ROW',
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'SUPPLIER',
    freshnessStatus: 'CURRENT',
    reviewDate: null,
    validUntil: null,
    sourcePeriodLabel: 'Mei 2026',
    sourcePeriodGranularity: 'YEAR',
    effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
    effectiveDateDerivationRule: 'YEAR_START',
    sourceImportRowId: 'import-row-may',
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
          id: 'bp-aug',
          value: new Prisma.Decimal('65000.00'),
          kdnPercent: new Prisma.Decimal('72.50'),
          createdAt: new Date('2026-08-28T03:00:00.000Z'),
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

  const observePrice = (overrides?: {
    expectedValue?: string;
    proposedValue?: string;
    effectiveDate?: string;
  }) =>
    service.observePrivatePrice({
      basicPriceId: PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: overrides?.expectedValue ?? '62500.00',
      proposedValue: overrides?.proposedValue ?? '65000.00',
      effectiveDate: overrides?.effectiveDate ?? '2026-08-28',
      reason: 'survei pasar Agustus',
    });

  it('PRICE-SEM-01 / PRICE-TIME-01 — new observation has its own business date and no supersession', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);

    const result = await observePrice();
    expect(result.unchanged).toBe(false);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      tx.basicPrice.create,
    ).data;
    expect(data.recordsNewObservation).toBe(true);
    expect(data.supersedesBasicPriceId).toBeUndefined();
    expect(data.sourceImportRowId).toBeUndefined();
    expect(data.sourcePeriodLabel).toBeUndefined();
    expect(data.effectiveDateProvenance).toBe('SOURCE_STATED');
    expect(data.effectiveDate).toEqual(new Date('2026-08-28T00:00:00.000Z'));
    expect(data.value).toEqual(new Prisma.Decimal('65000.00'));
    expect(data.sourceType).toBe('MARKET_SURVEY');
    expect(data.sourceOrigin).toBe('SUPPLIER');
    expect(data.reportedByAccountId).toBe(ACTOR.accountId);
  });

  it('PRICE-SEM-03 / PRICE-PROV-01 — audit names NEW_OBSERVATION and does not reuse import evidence', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    await observePrice();
    const audit = firstCallArg<{
      data: {
        before: { semantic: string; observedAfterBasicPriceId: string };
        after: { semantic: string; effectiveDate: string; value: string };
      };
    }>(tx.basicPriceProvenanceCorrection.create).data;
    expect(audit.before.semantic).toBe('NEW_OBSERVATION');
    expect(audit.before.observedAfterBasicPriceId).toBe(PREDECESSOR.id);
    expect(audit.after.semantic).toBe('NEW_OBSERVATION');
    expect(audit.after.effectiveDate).toBe('2026-08-28');
    expect(audit.after.value).toBe('65000.00');
    expect((audit.after as { evidenceClass?: string }).evidenceClass).toBe(
      'FIELD_REPORTED',
    );
    expect(JSON.stringify(audit)).not.toContain('import-row-may');
  });

  it('PRICE-CONC-01 — stale expected money fails closed', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      value: '70000.00',
    });
    await expect(observePrice()).rejects.toMatchObject({
      message: 'PRICE_STALE_FACT',
    });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRICE-IDEMP-01 — duplicate new observation returns the existing row', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce({
        id: 'bp-aug',
        value: '65000.00',
        kdnPercent: '72.50',
      });
    const result = await observePrice();
    expect(result).toEqual({
      basicPriceId: 'bp-aug',
      value: '65000.00',
      kdnPercent: '72.50',
      unchanged: true,
    });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRICE-SEM-02 — correction writer still copies the business date and supersedes', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    tx.basicPrice.create.mockResolvedValueOnce({
      id: 'bp-fix',
      value: new Prisma.Decimal('62500.00'),
    });
    await service.correctPrivatePrice({
      basicPriceId: PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: '62500.00',
      proposedValue: '62000.00',
      reason: 'salah baca invoice Mei',
    });
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      tx.basicPrice.create,
    ).data;
    expect(data.supersedesBasicPriceId).toBe(PREDECESSOR.id);
    expect(data.effectiveDate).toBe(MAY);
    expect(data.recordsNewObservation).toBeUndefined();
    const audit = firstCallArg<{
      data: { before: { value?: string; semantic?: string } };
    }>(tx.basicPriceProvenanceCorrection.create).data;
    expect(audit.before.value).toBe('62500.00');
    expect(audit.before.semantic).toBeUndefined();
  });

  it('KDN-SEM-02 — stated KDN correction supersedes and does not enrich', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    tx.basicPrice.create.mockResolvedValueOnce({
      id: 'bp-kdn-fix',
      value: new Prisma.Decimal('62500.00'),
      kdnPercent: new Prisma.Decimal('68.20'),
    });
    const result = await service.correctPrivateKdn({
      basicPriceId: PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: '62500.00',
      expectedKdnPercent: '72.50',
      proposedKdnPercent: '68.20',
      reason: 'angka sertifikat salah baca',
    });
    expect(result.unchanged).toBe(false);
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      tx.basicPrice.create,
    ).data;
    expect(data.supersedesBasicPriceId).toBe(PREDECESSOR.id);
    expect(data.value).toBe(PREDECESSOR.value);
    expect(data.effectiveDate).toBe(MAY);
    expect(data.kdnPercent).toEqual(new Prisma.Decimal('68.20'));
    expect(data.kdnEstablishment).toBe('MANUAL_CORRECTION');
    const audit = firstCallArg<{
      data: { before: { semantic: string; kdnPercent: string } };
    }>(tx.basicPriceProvenanceCorrection.create).data;
    expect(audit.before.semantic).toBe('CORRECTION');
    expect(audit.before.kdnPercent).toBe('72.50');
  });

  it('KDN-SEM-03 — new KDN observation does not overwrite and does not supersede', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce(null);
    tx.basicPrice.create.mockResolvedValueOnce({
      id: 'bp-kdn-new',
      value: new Prisma.Decimal('62500.00'),
      kdnPercent: new Prisma.Decimal('70.00'),
      createdAt: new Date('2026-08-28T03:00:00.000Z'),
    });
    await service.observePrivateKdn({
      basicPriceId: PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: '62500.00',
      expectedKdnPercent: '72.50',
      proposedKdnPercent: '70.00',
      effectiveDate: '2026-08-28',
      reason: 'sertifikat pabrik baru',
    });
    expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      tx.basicPrice.create,
    ).data;
    expect(data.recordsNewObservation).toBe(true);
    expect(data.supersedesBasicPriceId).toBeUndefined();
    expect(data.value).toEqual(new Prisma.Decimal('62500.00'));
    expect(data.kdnPercent).toEqual(new Prisma.Decimal('70.00'));
    expect(data.kdnEstablishment).toBe('MANUAL_NEW_OBSERVATION');
    const audit = firstCallArg<{
      data: { after: { semantic: string } };
    }>(tx.basicPriceProvenanceCorrection.create).data;
    expect(audit.after.semantic).toBe('NEW_OBSERVATION');
  });

  it('KDN-CONC-01 — stale stated KDN fails closed', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      kdnPercent: '80.00',
    });
    await expect(
      service.correctPrivateKdn({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        expectedKdnPercent: '72.50',
        proposedKdnPercent: '68.20',
        reason: 'stale',
      }),
    ).rejects.toMatchObject({ message: 'KDN_STALE_FACT' });
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('KDN-SEM-01 — missing KDN still cannot enter the correction writer', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      kdnPercent: null,
    });
    await expect(
      service.correctPrivateKdn({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        expectedKdnPercent: '72.50',
        proposedKdnPercent: '68.20',
        reason: 'should enrich',
      }),
    ).rejects.toMatchObject({ message: 'KDN_MISSING_USE_ENRICH' });
  });

  it('DETAIL-ROUTE-04 — foreign or catalog rows are indistinguishable from absence', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce(null);
    await expect(observePrice()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('PRICE-IDEMP-02 — duplicate correction of the same money is unchanged', async () => {
    tx.basicPrice.findFirst
      .mockResolvedValueOnce(PREDECESSOR)
      .mockResolvedValueOnce({
        id: 'bp-fix',
        value: '62000.00',
      });
    const result = await service.correctPrivatePrice({
      basicPriceId: PREDECESSOR.id,
      actor: ACTOR,
      expectedValue: '62500.00',
      proposedValue: '62000.00',
      reason: 'salah baca invoice Mei',
    });
    expect(result.unchanged).toBe(true);
    expect(tx.basicPrice.create).not.toHaveBeenCalled();
  });

  it('concurrent stale expected is ConflictException', async () => {
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      ...PREDECESSOR,
      value: '1.00',
    });
    await expect(observePrice()).rejects.toBeInstanceOf(ConflictException);
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';

/**
 * RM-03C — the ONE production writer of a WORKSPACE_PRIVATE Basic Price.
 *
 * What these tests are really pinning: a private price is usable immediately,
 * WITHOUT anyone pretending it was published, and WITHOUT anything about it
 * being invented. Every fact it carries must trace back to a human-resolved
 * import row and its batch.
 */
describe('BasicPricePrivateAssetService', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const organizationId = '21000000-0000-4000-8000-000000000001';
  const accountId = '40000000-0000-4000-8000-000000000001';
  const batchId = '60000000-0000-4000-8000-000000000001';
  const rowId = '70000000-0000-4000-8000-000000000001';
  const resourceCatalogId = '80000000-0000-4000-8000-000000000001';
  const regionId = '90000000-0000-4000-8000-000000000001';

  const actor: TrustedBasicPriceActor = {
    accountId,
    userId: '50000000-0000-4000-8000-000000000001',
    workspaceId,
  };

  const baseBatch = () => ({
    id: batchId,
    workspaceId,
    organizationId,
    status: 'READY_FOR_REVIEW',
    effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
    regionId,
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'STORE',
    uploadedByAccountId: accountId,
  });

  const baseRow = () => ({
    id: rowId,
    resourceCatalogId,
    proposedCanonicalPrice: new Prisma.Decimal('137500.00'),
    effectiveDateOverride: null,
  });

  const createdRow = () => ({
    id: 'bp-private-1',
    value: new Prisma.Decimal('137500.00'),
    effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
    status: 'UNPUBLISHED',
    verificationStatus: 'UNVERIFIED',
    sourceOrigin: 'STORE',
    sourceImportRowId: rowId,
    resource: { id: resourceCatalogId, code: 'L.01', name: 'Pekerja', type: 'LABOR' },
    region: { id: regionId, code: 'ID-JK', name: 'DKI Jakarta' },
  });

  let tx: any;
  let prisma: any;
  let service: BasicPricePrivateAssetService;

  const makeTx = (overrides: { batch?: any; rows?: Array<{ id: string }> } = {}) => {
    const batch = overrides.batch === undefined ? baseBatch() : overrides.batch;
    const rows = overrides.rows ?? [{ id: rowId }];
    let queryCall = 0;
    tx = {
      $queryRaw: jest.fn().mockImplementation(() => {
        queryCall += 1;
        // 1st raw query: the batch lock. 2nd: the ready-row lock.
        return Promise.resolve(queryCall === 1 ? (batch ? [batch] : []) : rows);
      }),
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ organizationId }),
      },
      basicPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdRow()),
      },
      basicPriceImportRow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(baseRow()),
      },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    return tx;
  };

  beforeEach(() => {
    prisma = { $transaction: jest.fn() };
    service = new BasicPricePrivateAssetService(prisma as any);
  });

  describe('the ownership and provenance a private price is born with', () => {
    it('creates a WORKSPACE_PRIVATE price bound to the trusted workspace and the import row', async () => {
      makeTx();

      const result = await service.keepBatchPrivate({ batchId, actor });

      expect(tx.basicPrice.create).toHaveBeenCalledTimes(1);
      const data = tx.basicPrice.create.mock.calls[0][0].data;
      expect(data.assetScope).toBe('WORKSPACE_PRIVATE');
      expect(data.workspaceId).toBe(workspaceId);
      expect(data.organizationId).toBe(organizationId);
      expect(data.sourceImportRowId).toBe(rowId);
      expect(result.createdCount).toBe(1);
      expect(result.alreadyPrivateCount).toBe(0);
      expect(result.prices[0].assetScope).toBe('WORKSPACE_PRIVATE');
    });

    it('NEVER fakes publication: status and verificationStatus are not written at all', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });

      const data = tx.basicPrice.create.mock.calls[0][0].data;
      // Omitted, so the row takes the schema defaults UNPUBLISHED/UNVERIFIED.
      // A private asset becomes usable through eligibility, never by claiming
      // it went through a publication ladder it never entered.
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('verificationStatus');
      expect(data).not.toHaveProperty('reviewDate');
    });

    it('creates no submission, no review, and no publication audit', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });

      expect(tx.priceSubmission).toBeUndefined();
      expect(tx.priceSubmissionReview).toBeUndefined();
      expect(tx.basicPricePublicationAudit).toBeUndefined();
      const data = tx.basicPrice.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('sourceSubmissionId');
    });

    it('records the trusted server-derived actor as reporter, never a client value', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });

      expect(tx.basicPrice.create.mock.calls[0][0].data.reportedByAccountId).toBe(
        accountId,
      );
    });
  });

  describe('ownership is independent of source (SOURCE != REPORTER)', () => {
    it.each(['GOVERNMENT', 'SUPPLIER', 'STORE', 'DISTRIBUTOR', 'FIELD_REPORT'])(
      'keeps sourceOrigin=%s verbatim on a WORKSPACE_PRIVATE price',
      async (sourceOrigin) => {
        makeTx({ batch: { ...baseBatch(), sourceOrigin } });

        await service.keepBatchPrivate({ batchId, actor });

        const data = tx.basicPrice.create.mock.calls[0][0].data;
        // The asset is private; the PRICE still came from wherever it came
        // from. There is no "PRIVATE" source family, and this writer never
        // substitutes one.
        expect(data.sourceOrigin).toBe(sourceOrigin);
        expect(data.assetScope).toBe('WORKSPACE_PRIVATE');
      },
    );

    it('copies sourceType from the batch, defaulting only where the import path already did', async () => {
      makeTx({ batch: { ...baseBatch(), sourceType: null } });
      await service.keepBatchPrivate({ batchId, actor });
      expect(tx.basicPrice.create.mock.calls[0][0].data.sourceType).toBe(
        'MARKET_SURVEY',
      );
    });
  });

  describe('nothing is invented', () => {
    it('carries the exact Decimal from the resolved row — no float, no rounding', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });

      const { value } = tx.basicPrice.create.mock.calls[0][0].data;
      expect(value).toBeInstanceOf(Prisma.Decimal);
      expect(value.toString()).toBe('137500');
      expect(value.equals(new Prisma.Decimal('137500.00'))).toBe(true);
    });

    it('uses the row effective-date override when a human set one', async () => {
      const override = new Date('2026-08-03T00:00:00.000Z');
      makeTx();
      tx.basicPriceImportRow.findUniqueOrThrow.mockResolvedValue({
        ...baseRow(),
        effectiveDateOverride: override,
      });

      await service.keepBatchPrivate({ batchId, actor });
      expect(tx.basicPrice.create.mock.calls[0][0].data.effectiveDate).toBe(
        override,
      );
    });

    it.each([
      ['effectiveDate', 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE'],
      ['regionId', 'REGION_REQUIRED_BEFORE_PRIVATE_USE'],
      ['sourceOrigin', 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE'],
    ])('refuses when the batch has no %s — never fabricates one', async (field, reason) => {
      makeTx({ batch: { ...baseBatch(), [field]: null } });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toMatchObject({ message: reason });
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('refuses a row with no resolved resource identity or no canonical price', async () => {
      for (const broken of [
        { resourceCatalogId: null },
        { proposedCanonicalPrice: null },
      ]) {
        makeTx();
        tx.basicPriceImportRow.findUniqueOrThrow.mockResolvedValue({
          ...baseRow(),
          ...broken,
        });

        await expect(
          service.keepBatchPrivate({ batchId, actor }),
        ).rejects.toMatchObject({ message: 'ROW_NOT_RESOLVED' });
        expect(tx.basicPrice.create).not.toHaveBeenCalled();
      }
    });
  });

  describe('tenant safety', () => {
    it('reports another workspace batch as plain non-existence', async () => {
      makeTx({ batch: { ...baseBatch(), workspaceId: 'ws-other' } });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('reports another account batch as plain non-existence (user-owned import boundary)', async () => {
      makeTx({ batch: { ...baseBatch(), uploadedByAccountId: 'acc-other' } });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when the batch organization no longer matches the workspace organization', async () => {
      makeTx();
      tx.workspace.findUnique.mockResolvedValue({ organizationId: 'org-other' });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('writes the workspace from the trusted actor, never from the batch alone', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });
      // Same value here, but it is compared against actor.workspaceId before
      // anything is written — a batch row can never steer the write.
      const lockSql = JSON.stringify(tx.$queryRaw.mock.calls[0][0]);
      expect(lockSql).toContain('FOR UPDATE');
      expect(tx.basicPrice.create.mock.calls[0][0].data.workspaceId).toBe(
        actor.workspaceId,
      );
    });
  });

  describe('lifecycle and idempotency', () => {
    it('requires the batch to be READY_FOR_REVIEW, like submit does', async () => {
      makeTx({ batch: { ...baseBatch(), status: 'PREVIEWED' } });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when no row has been resolved to READY_FOR_SUBMISSION', async () => {
      makeTx({ rows: [] });

      await expect(
        service.keepBatchPrivate({ batchId, actor }),
      ).rejects.toMatchObject({ message: 'NO_ROWS_READY_FOR_PRIVATE_USE' });
    });

    it('is idempotent: a row that already has a private price is returned, not duplicated', async () => {
      makeTx();
      tx.basicPrice.findFirst.mockResolvedValue(createdRow());

      const result = await service.keepBatchPrivate({ batchId, actor });

      expect(tx.basicPrice.create).not.toHaveBeenCalled();
      expect(result.createdCount).toBe(0);
      expect(result.alreadyPrivateCount).toBe(1);
      expect(result.prices).toHaveLength(1);
    });

    it('never advances the batch or the row lifecycle', async () => {
      makeTx();
      await service.keepBatchPrivate({ batchId, actor });

      // Keeping rows private is NOT submitting them. The batch stays exactly
      // where it was, so the same rows may still be proposed to SIMPROK later
      // — and a proposal rejection can never invalidate the private asset.
      expect(tx.basicPriceImportBatch).toBeUndefined();
      expect(tx.basicPriceImportRow.update).toBeUndefined();
    });
  });

  describe('projection', () => {
    it('returns an explicit projection with exact money, never a raw entity', async () => {
      makeTx();
      const result = await service.keepBatchPrivate({ batchId, actor });

      expect(result.prices[0]).toEqual({
        basicPriceId: 'bp-private-1',
        resource: {
          id: resourceCatalogId,
          code: 'L.01',
          name: 'Pekerja',
          type: 'LABOR',
        },
        region: { id: regionId, code: 'ID-JK', name: 'DKI Jakarta' },
        price: '137500.00',
        effectiveDate: '2026-08-01T00:00:00.000Z',
        assetScope: 'WORKSPACE_PRIVATE',
        sourceOrigin: 'STORE',
        // Echoed so a caller can SEE the publication axes were left alone.
        status: 'UNPUBLISHED',
        verificationStatus: 'UNVERIFIED',
        sourceImportRowId: rowId,
      });
      expect(typeof result.prices[0].price).toBe('string');
    });
  });
});

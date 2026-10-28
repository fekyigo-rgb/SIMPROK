import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';

const WORKSPACE = '10000000-0000-4000-8000-000000000004';
const ACCOUNT = '10000000-0000-4000-8000-000000000007';
const BATCH = '2b81f706-77ce-40c2-98f0-020d603e5ac2';
const ROW = '7ad01c8c-b9af-40b1-83fc-2ff3f35d5390';
const REASON = 'Penolakan sebelumnya salah karena bahan masih perlu ditinjau.';
const PRIOR = 'REJECTED:Harga dianggap tidak tepat sebelum bukti sumber diperiksa.';

describe('BP-C1 reopen rejected import decision — append-only, fail closed', () => {
  function setup() {
    const batch = {
      id: BATCH, workspaceId: WORKSPACE, uploadedByAccountId: ACCOUNT,
      status: 'READY_FOR_REVIEW',
    };
    const row = {
      id: ROW, batchId: BATCH, status: 'REJECTED', resolutionStatus: 'UNRESOLVED',
      version: 4, reasonCodes: ['PRICE_FROM_TEXT', PRIOR],
      privateBasicPrice: null, priceSubmissionId: null,
      resourceCatalogId: null, unitDefinitionId: null,
      rawResourceNameText: 'Pasir', rawUnitText: 'M3',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ROW }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      basicPriceImportBatch: {
        findUnique: jest.fn().mockResolvedValue(batch),
        findUniqueOrThrow: jest.fn().mockResolvedValue(batch),
        update: jest.fn().mockResolvedValue(batch),
      },
      basicPriceImportRow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (db: typeof tx) => unknown) => work(tx)),
    };
    const service = new BasicPriceRowResolutionService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    const act = (version = 4, actor = ACCOUNT) =>
      service.reopenRejectedRow(WORKSPACE, BATCH, ROW, actor, { version, reason: REASON });
    return { row, batch, tx, act, prisma };
  }

  it('reopens only this rejected row; records actor, old rejection, version and reason', async () => {
    const { act, tx } = setup();
    const result = await act();
    expect(result).toEqual({
      batchId: BATCH, rowId: ROW, priorRowVersion: 4,
      newRowVersion: 5, status: 'NEEDS_REVIEW',
    });
    const write = tx.basicPriceImportRow.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({
      id: ROW, batchId: BATCH, version: 4, status: 'REJECTED',
    });
    expect(write.data).toEqual({
      status: 'NEEDS_REVIEW', resolvedByAccountId: null,
      resolvedAt: null, version: { increment: 1 },
    });
    expect(write.data).not.toHaveProperty('reasonCodes');
    expect(write.data).not.toHaveProperty('resourceCatalogId');
    expect(write.data).not.toHaveProperty('rawResourceNameText');
    expect(write.data).not.toHaveProperty('proposedCanonicalPrice');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const audit = tx.$executeRaw.mock.calls[0][0];
    expect(audit.strings.join(' ')).toContain('basic_price_import_row_rejected_review_reopens');
    expect(audit.values).toContain(PRIOR);
    expect(audit.values).toContain(REASON);
    expect(audit.values).toContain(ACCOUNT);
    expect(audit.values).toContain(4);
    expect(audit.values).toContain(5);
  });

  it('rejects stale client version without touching state', async () => {
    const { act, tx } = setup();
    await expect(act(3)).rejects.toThrow('ROW_VERSION_STALE');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an already materialized private Basic Price', async () => {
    const { row, tx, act } = setup();
    row.privateBasicPrice = { id: ROW } as never;
    await expect(act()).rejects.toThrow('REJECTED_ROW_NOT_REOPENABLE');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('never reopens a batch already submitted / finalized', async () => {
    const { batch, tx, act } = setup();
    batch.status = 'SUBMITTED';
    await expect(act()).rejects.toThrow('BATCH_NOT_MUTABLE');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('never reopens someone else\'s batch', async () => {
    const { tx, act } = setup();
    await expect(act(4, '10000000-0000-4000-8000-000000000099')).rejects.toThrow();
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an ambiguous or non-rejected decision', async () => {
    const { row, tx, act } = setup();
    row.status = 'READY_FOR_SUBMISSION';
    await expect(act()).rejects.toThrow('REJECTED_ROW_NOT_REOPENABLE');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses reopening without an original rejection audit', async () => {
    const { row, tx, act } = setup();
    row.reasonCodes = ['PRICE_FROM_TEXT'];
    await expect(act()).rejects.toThrow('REJECTION_AUDIT_MISSING');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('requires a material human reason, never silent undo', async () => {
    const { tx } = setup();
    const service = new BasicPriceRowResolutionService(
      { $transaction: jest.fn() } as never,
      {} as never, {} as never, {} as never, {} as never,
    );
    await expect(service.reopenRejectedRow(
      WORKSPACE, BATCH, ROW, ACCOUNT, { version: 4, reason: 'salah' },
    )).rejects.toThrow('REOPEN_REASON_REQUIRED');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

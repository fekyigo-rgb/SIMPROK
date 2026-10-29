import { BadRequestException } from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';

function createSubject(items: Array<Record<string, unknown>>, counts: Array<Record<string, unknown>>) {
  const findMany = jest.fn().mockResolvedValue(items);
  const query = jest.fn().mockResolvedValueOnce(items).mockResolvedValueOnce(counts);
  const subject = Object.create(BasicPriceImportService.prototype) as BasicPriceImportService;
  Object.assign(subject, {
    prisma: {
      basicPriceImportBatch: { findMany },
      $queryRaw: query,
    },
  });
  return { subject, findMany, query };
}

const batch = {
  id: BATCH,
  sourceFileName: 'Daftar Harga Ambon.xlsx',
  selectedSheetName: 'Harga',
  status: 'NEEDS_REVIEW',
  sourceSha256: 'f'.repeat(64),
  createdAt: new Date('2026-10-28T10:00:00Z'),
  updatedAt: new Date('2026-10-28T11:00:00Z'),
};

describe('Basic Price owned import history: read-only, incremental private save preserved', () => {
  it('lists only uploader-owned batches in workspace and counts actual saved prices separately from pending rows', async () => {
    const { subject, findMany, query } = createSubject([batch], [{
      batchId: BATCH,
      total: 85,
      pending: 35,
      readyToSave: 0,
      savedPrivate: 50,
      rejected: 0,
      submitted: 0,
    }]);
    const out = await subject.listOwnedImportHistory(WORKSPACE, ACTOR);
    expect(out).toEqual({
      items: [{
        batchId: BATCH,
        sourceFileName: 'Daftar Harga Ambon.xlsx',
        selectedSheetName: 'Harga',
        status: 'NEEDS_REVIEW',
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        totalRows: 85,
        pendingRows: 35,
        readyToSaveRows: 0,
        savedPrivateRows: 50,
        rejectedRows: 0,
        submittedRows: 0,
      }],
      page: 1,
      hasNext: false,
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
    const historySql = query.mock.calls[0][0];
    expect(historySql.strings.join(' ')).toContain('"historyDismissedAt" IS NULL');
    expect(historySql.values).toContain(WORKSPACE);
    expect(historySql.values).toContain(ACTOR);
    const sql = query.mock.calls[1][0];
    expect(sql.strings.join(' ')).toContain('LEFT JOIN "basic_prices"');
    expect(sql.strings.join(' ')).toContain('p."sourceImportRowId" = r."id"');
    expect(sql.strings.join(' ')).toContain('r."status" IN (\'PARSED\', \'NEEDS_REVIEW\')');
    expect(sql.values).toContain(WORKSPACE);
    expect(sql.values).toContain(BATCH);
    expect(JSON.stringify(out)).not.toContain('sourceSha256');
  });

  it('returns empty without accessing row/price data when no owned batch is visible', async () => {
    const { subject, query } = createSubject([], []);
    expect(await subject.listOwnedImportHistory(WORKSPACE, ACTOR)).toEqual({
      items: [], page: 1, hasNext: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('paginates in bounded stable order and never returns the extra look-ahead batch', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      ...batch,
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    }));
    const { subject, findMany, query } = createSubject(items, []);
    const result = await subject.listOwnedImportHistory(WORKSPACE, ACTOR, '2');
    expect(result.page).toBe(2);
    expect(result.hasNext).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(findMany).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0].values).toContain(20);
    expect(query.mock.calls[0][0].values).toContain(21);
  });

  it('rejects invalid and unbounded pages before accessing data', async () => {
    const { subject, findMany, query } = createSubject([], []);
    for (const bad of ['0', '-1', '1.5', 'bad', '1001', '99999']) {
      await expect(subject.listOwnedImportHistory(WORKSPACE, ACTOR, bad))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    expect(findMany).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

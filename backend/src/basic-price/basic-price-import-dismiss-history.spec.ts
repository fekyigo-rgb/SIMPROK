import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';

const W = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

function setup(opts: {
  exists?: boolean; dismissed?: boolean; saved?: bigint; submitted?: bigint;
  status?: string; ingestionChannel?: string;
} = {}) {
  const updateSQL: string[] = [];
  const query = jest.fn()
    .mockImplementation(async (sql: { strings: readonly string[] }) => {
      const text = sql.strings.join(' ');
      if (text.includes('FOR UPDATE') && text.includes('basic_price_import_batches')) {
        return opts.exists === false ? [] : [{
          id: B, status: opts.status ?? 'NEEDS_REVIEW',
          ingestionChannel: opts.ingestionChannel ?? 'USER_UPLOAD',
          dismissed: opts.dismissed ? new Date() : null,
        }];
      }
      if (text.includes('FOR UPDATE') && text.includes('basic_price_import_rows')) return [{ id: 'row1' }];
      if (text.includes('AS saved')) return [{ saved: opts.saved ?? 0n, submitted: opts.submitted ?? 0n }];
      if (text.includes('UPDATE "basic_price_import_batches"')) {
        updateSQL.push(text);
        return [{ id: B }];
      }
      throw new Error('UNEXPECTED_SQL');
    });
  const transaction = jest.fn(async (callback: (tx: { $queryRaw: typeof query }) => Promise<unknown>) =>
    callback({ $queryRaw: query }));
  const service = Object.create(BasicPriceImportService.prototype) as BasicPriceImportService;
  Object.assign(service, { prisma: { $transaction: transaction } });
  return { service, transaction, updateSQL, query };
}

describe('Dismiss draft from active Basic Price history, preserve source truth', () => {
  it('archives an owner-owned, unfinished, unsaved manual batch without deleting anything', async () => {
    const { service, updateSQL, query } = setup();
    const res = await service.dismissUnfinishedImportHistory(W, B, A);
    expect(res).toEqual({ batchId: B, hiddenFromHistory: true });
    expect(updateSQL).toHaveLength(1);
    expect(updateSQL[0]).toContain('"historyDismissedAt" = NOW()');
    expect(updateSQL[0]).toContain('"historyDismissedByAccountId"');
    expect(updateSQL[0]).not.toMatch(/DELETE\s+FROM/i);
    expect(query.mock.calls.map(x => x[0].strings.join(' ')).join(' ')).toContain('FOR UPDATE');
  });

  it.each([{saved: 1n}, {submitted: 1n}, {status: 'SUBMITTED'}, {status: 'PARTIALLY_SUBMITTED'}, {ingestionChannel: 'API'}])(
    'rejects an externally sent or committed batch', async (o) => {
      const { service, updateSQL } = setup(o);
      await expect(service.dismissUnfinishedImportHistory(W, B, A))
        .rejects.toBeInstanceOf(ConflictException);
      expect(updateSQL).toHaveLength(0);
    }
  );

  it('foreign ownership/unknown batch is indistinguishable from absent', async () => {
    const { service, updateSQL } = setup({exists:false});
    await expect(service.dismissUnfinishedImportHistory(W, B, A))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(updateSQL).toHaveLength(0);
  });

  it('repeat request is harmless, without another mutation', async () => {
    const {service,updateSQL} = setup({dismissed:true});
    expect(await service.dismissUnfinishedImportHistory(W,B,A)).toEqual({
      batchId:B,hiddenFromHistory:true,
    });
    expect(updateSQL).toHaveLength(0);
  });
});

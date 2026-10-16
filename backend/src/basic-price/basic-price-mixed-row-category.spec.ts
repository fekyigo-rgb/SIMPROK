import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { ConfirmBasicPriceImportRowCategoryDto } from './dto/resolve-basic-price-import-row.dto';

/** Data-free tests. No remote database, login, or runtime access. */
describe('BP-PR205 mixed row category governance', () => {
  const account = '00000000-0000-4000-8000-000000000011';
  const otherAccount = '00000000-0000-4000-8000-000000000012';
  const workspace = '00000000-0000-4000-8000-000000000021';
  const batchId = '00000000-0000-4000-8000-000000000031';
  const rowId = '00000000-0000-4000-8000-000000000041';
  const batch = () => ({ id: batchId, workspaceId: workspace, uploadedByAccountId: account, status: 'NEEDS_REVIEW' });
  const row = () => ({
    id: rowId, batchId, version: 3, status: 'NEEDS_REVIEW', sourceSection: null,
    sourceSectionProvenance: null, rawSourceCategoryName: null, rawSourceCategoryCode: null,
  });

  function harness(b = batch(), r = row()) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([b]).mockResolvedValueOnce([r]),
      basicPriceImportRow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      basicPriceImportRowCategoryDecision: { create: jest.fn().mockResolvedValue({ id: 'decision' }) },
    };
    const prisma = { $transaction: jest.fn((action: (tx: unknown) => unknown) => action(tx)) };
    const service = new BasicPriceRowResolutionService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    const decide = (version = 3, user = account, type = 'MATERIAL' as 'MATERIAL' | 'LABOR' | 'EQUIPMENT') =>
      service.confirmRowCategory(workspace, batchId, rowId, user, { version, resourceType: type });
    return { tx, decide };
  }

  it('writes only an accountable human category + append-only event, preserving raw source', async () => {
    const { tx, decide } = harness();
    expect(await decide()).toMatchObject({ version: 4, resourceType: 'MATERIAL', unchanged: false });
    expect(tx.basicPriceImportRow.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batchId, version: 3, status: 'NEEDS_REVIEW' }),
      data: expect.objectContaining({
        sourceSection: 'MATERIAL', sourceSectionProvenance: 'UPLOADER_DECLARED',
        reasonCodes: { push: 'ROW_CATEGORY_CONFIRMED_BY_REVIEWER' }, version: { increment: 1 },
      }),
    }));
    expect(tx.basicPriceImportRowCategoryDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: workspace, rowId, actorAccountId: account,
        previousSection: null, chosenSection: 'MATERIAL', previousVersion: 3, resultingVersion: 4,
      }),
    });
    const patch = tx.basicPriceImportRow.updateMany.mock.calls[0][0].data;
    expect(patch.rawSourceCategoryName).toBeUndefined();
    expect(patch.rawResourceNameText).toBeUndefined();
    expect(patch.rawPriceDisplayText).toBeUndefined();
  });

  it('returns unchanged for same human-assigned category, without a new audit event', async () => {
    const { tx, decide } = harness(batch(), { ...row(), sourceSection: 'MATERIAL', sourceSectionProvenance: 'UPLOADER_DECLARED' });
    expect(await decide()).toMatchObject({ version: 3, unchanged: true });
    expect(tx.basicPriceImportRowCategoryDecision.create).not.toHaveBeenCalled();
  });

  it('rejects stale edits before writes', async () => {
    const { tx, decide } = harness();
    await expect(decide(2)).rejects.toThrow(ConflictException);
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('rejects wrong workspace before writes', async () => {
    const { tx, decide } = harness({ ...batch(), workspaceId: otherAccount });
    await expect(decide()).rejects.toThrow(NotFoundException);
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a different account on the same workspace', async () => {
    const { tx, decide } = harness();
    await expect(decide(3, otherAccount)).rejects.toThrow(NotFoundException);
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('refuses overriding document-proven categories', async () => {
    const { tx, decide } = harness(batch(), { ...row(), sourceSection: 'EQUIPMENT', sourceSectionProvenance: 'SOURCE_ROW_CATEGORY' });
    await expect(decide()).rejects.toThrow(ConflictException);
    expect(tx.basicPriceImportRowCategoryDecision.create).not.toHaveBeenCalled();
  });

  it('refuses changing a row with unresolved explicit source category words', async () => {
    const { tx, decide } = harness(batch(), { ...row(), rawSourceCategoryName: 'Unrecognized raw label' });
    await expect(decide()).rejects.toThrow(ConflictException);
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('refuses after batch or row became immutable', async () => {
    await expect(harness({ ...batch(), status: 'SUBMITTED' }).decide()).rejects.toThrow(ConflictException);
    await expect(harness(batch(), { ...row(), status: 'REJECTED' }).decide()).rejects.toThrow(ConflictException);
  });


  it('takes the contested second row lock with NOWAIT, not an unbounded wait', async () => {
    const { tx, decide } = harness();
    await decide();
    const lockQuery = tx.$queryRaw.mock.calls[1][0] as { strings: readonly string[] };
    expect(lockQuery.strings.join(' ')).toContain('FOR UPDATE NOWAIT');
    const batchQuery = tx.$queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(batchQuery.strings.join(' ')).toContain('FOR UPDATE');
  });

  it('fails fast with a retryable 409 and no row write or audit when the row is busy', async () => {
    const { tx, decide } = harness();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([batch()])
      .mockRejectedValueOnce({ code: 'P2010', meta: { code: '55P03' } });
    await expect(decide()).rejects.toThrow('ROW_BUSY_RETRY');
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
    expect(tx.basicPriceImportRowCategoryDecision.create).not.toHaveBeenCalled();
    // After the other transaction completes, one normal retry can succeed.
    const recovered = harness();
    await expect(recovered.decide()).resolves.toMatchObject({
      version: 4, resourceType: 'MATERIAL', unchanged: false,
    });
  });

  it('does not disguise arbitrary database faults as a retryable row conflict', async () => {
    const { tx, decide } = harness();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([batch()])
      .mockRejectedValueOnce({ code: 'P2010', meta: { code: '42601' } });
    await expect(decide()).rejects.toMatchObject({ code: 'P2010' });
    expect(tx.basicPriceImportRow.updateMany).not.toHaveBeenCalled();
  });

  it('rejects MIXED and unknown types at request-validation boundary', () => {
    for (const resourceType of ['MIXED', 'UNDEFINED']) {
      const dto = plainToInstance(ConfirmBasicPriceImportRowCategoryDto, { version: 3, resourceType });
      const errors = validateSync(dto);
      expect(errors.some((error) => error.property === 'resourceType')).toBe(true);
    }
  });
});

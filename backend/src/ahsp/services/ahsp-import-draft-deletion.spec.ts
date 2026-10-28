import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';

const JOB = 'a6c94b00-f5ba-40da-a43b-40a67c3931e4';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';

function createSubject(draft: number, completed: number, remaining: number, deleted = draft) {
  const tx = {
    aHSPImportJob: {
      findFirst: jest.fn().mockResolvedValue({ id: JOB }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aHSPImportLine: {
      count: jest.fn()
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce(remaining),
      deleteMany: jest.fn().mockResolvedValue({ count: deleted }),
    },
  };
  // Guard: the draft-delete path receives NO canonical AHSP or catalog writer.
  const prisma = { $transaction: jest.fn(async (fn: (c: typeof tx) => Promise<unknown>) => fn(tx)) };
  const subject = Object.create(AhspDocumentCanonicalizationService.prototype) as AhspDocumentCanonicalizationService;
  Object.assign(subject, { prisma });
  return { subject, tx, prisma };
}

describe('AHSP draft cleanup is strictly scoped, preserving already-saved assets', () => {
  it('removes only incomplete rows, retains completed journal and canonical AHSP', async () => {
    const { subject, tx, prisma } = createSubject(2, 1, 1);
    const result = await subject.deleteUnfinishedImportDraft({ workspaceId: WORKSPACE, importJobId: JOB });
    expect(result).toEqual({ deletedDraftItems: 2, preservedCompletedItems: 1, journalRemoved: false });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.aHSPImportJob.findFirst).toHaveBeenCalledWith({
      where: { id: JOB, workspaceId: WORKSPACE }, select: { id: true },
    });
    expect(tx.aHSPImportLine.deleteMany).toHaveBeenCalledWith({
      where: { importJobId: JOB, workspaceId: WORKSPACE, status: { in: ['PENDING', 'FAILED'] } },
    });
    expect(tx.aHSPImportJob.deleteMany).not.toHaveBeenCalled();
    expect(tx.aHSPImportJob.updateMany).toHaveBeenCalledWith({
      where: { id: JOB, workspaceId: WORKSPACE }, data: { status: 'COMPLETED' },
    });
  });

  it('fully unfinished journal is removed without calling any canonical writer', async () => {
    const { subject, tx } = createSubject(3, 0, 0);
    expect(await subject.deleteUnfinishedImportDraft({ workspaceId: WORKSPACE, importJobId: JOB }))
      .toEqual({ deletedDraftItems: 3, preservedCompletedItems: 0, journalRemoved: true });
    expect(tx.aHSPImportJob.deleteMany).toHaveBeenCalledWith({ where: { id: JOB, workspaceId: WORKSPACE } });
    expect(tx.aHSPImportJob.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a completed-only journal without removing any data', async () => {
    const { subject, tx } = createSubject(0, 1, 1);
    await expect(subject.deleteUnfinishedImportDraft({ workspaceId: WORKSPACE, importJobId: JOB }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.aHSPImportLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.aHSPImportJob.deleteMany).not.toHaveBeenCalled();
  });

  it('rolls back if the counts changed mid-transaction', async () => {
    const { subject, tx } = createSubject(2, 1, 1, 1);
    await expect(subject.deleteUnfinishedImportDraft({ workspaceId: WORKSPACE, importJobId: JOB }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.aHSPImportJob.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid id before entering the transaction', async () => {
    const { subject, prisma } = createSubject(1, 0, 0);
    await expect(subject.deleteUnfinishedImportDraft({ workspaceId: WORKSPACE, importJobId: 'not-a-uuid' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

const harness = (deletedCount: number, completedCount: number, waitingCount = 0) => {
  const lines = Array.from({ length: completedCount }, (_, i) => ({
    id: 'line-' + i, importJobId: jobId, lineNumber: i + 1, status: 'COMPLETED',
    ahspId: 'ahsp-' + i, ahspVersionId: 'version-' + i,
  }));
  const waiting = Array.from({ length: waitingCount }, (_, i) => ({
    lineNumber: completedCount + i + 1, status: 'PENDING', reasonCodes: [],
    workType: 'Uji', methodName: 'Uji',
  }));
  const aHSP = { findMany: jest.fn().mockResolvedValue(
    lines.slice(0, deletedCount).map((line) => ({ id: line.ahspId })),
  ) };
  const service = Object.create(AhspDocumentCanonicalizationService.prototype) as AhspDocumentCanonicalizationService;
  const prisma = {
    aHSP,
    ahspImportUnitDecision: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const journal = {
    listDocuments: jest.fn().mockResolvedValue({
      jobs: [{
        importJobId: jobId, sourceFileName: 'AHSP BINA MARGA.xlsx',
        sourceSha256: null, status: 'COMPLETED', createdAt: new Date('2026-10-12T14:22:37Z'),
        updatedAt: new Date('2026-10-12T14:22:37Z'),
        counts: { received: completedCount + waitingCount, represented: completedCount, waiting: waitingCount },
        waiting,
      }],
      nextCursor: null, hasMore: false,
    }),
    loadCompletionLines: jest.fn().mockResolvedValue(lines),
  };
  Object.assign(service, {
    prisma, journal,
    observations: { openQuestionsBySource: jest.fn().mockResolvedValue(new Map()) },
    recipeStates: jest.fn().mockResolvedValue(new Map(lines.map((line) => [line.id, 'NOT_USABLE']))),
  });
  return { service, aHSP };
};

describe('AHSP import history truth: saved-but-soft-deleted is not an unfinished draft', () => {
  it('shows 71 canonical deleted AHSP separately, no fake recipe or pending-work count', async () => {
    const { service, aHSP } = harness(71, 71);
    const page = await service.listImportJobs(workspaceId);
    expect(page.items).toHaveLength(1);
    const [job] = page.items;
    expect(job.counts).toEqual({ received: 71, represented: 71, waiting: 0 });
    expect(job.completion).toMatchObject({
      complete: 0, deletedAhsp: 71, recipeNotUsable: 0, awaitingIdentity: 0,
    });
    expect(job.waiting).toEqual([]);
    expect(aHSP.findMany).toHaveBeenCalledWith({
      where: { workspaceId, id: { in: expect.arrayContaining(['ahsp-0', 'ahsp-70']) }, deletedAt: { not: null } },
      select: { id: true },
    });
  });

  it('never double-counts one deleted AHSP as a NOT_USABLE active recipe', async () => {
    const { service } = harness(1, 3, 1);
    const { items } = await service.listImportJobs(workspaceId);
    expect(items[0].completion).toMatchObject({
      deletedAhsp: 1, recipeNotUsable: 2, complete: 0, awaitingIdentity: 0,
    });
    expect(items[0].waiting).toHaveLength(1);
  });

  it('preserves existing semantics for active unsaved and non-deleted completed rows', async () => {
    const { service, aHSP } = harness(0, 1, 0);
    const { items } = await service.listImportJobs(workspaceId);
    expect(items[0].completion).toMatchObject({ recipeNotUsable: 1 });
    expect(items[0].completion).not.toHaveProperty('deletedAhsp');
    expect(aHSP.findMany).toHaveBeenCalledTimes(1);
  });
});

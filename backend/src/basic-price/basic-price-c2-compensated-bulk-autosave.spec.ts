import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';

/**
 * BP-C2: a compensation is a human withdrawal of one accepted mapping.
 * The next bulk smart-save may still examine other proven rows, but it must
 * NOT re-accept the withdrawn decision merely because the kernel still
 * recognizes the same catalog item.
 *
 * No second resolver or machine algorithm is introduced. This test pins the
 * canonical Prisma query that decides who enters the existing bulk path.
 */
describe('BP-C2 - compensated mapping is never silently reaccepted in bulk', () => {
  it('excludes rows with any compensation before machine proposal and writes', async () => {
    const batchId = 'batch-a';
    const workspaceId = 'workspace-a';
    const reviewerId = 'reviewer-a';
    const prisma = {
      basicPriceImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: batchId,
          workspaceId,
          uploadedByAccountId: reviewerId,
          status: 'NEEDS_REVIEW',
          sourceSha256: 'b'.repeat(64),
        }),
      },
      basicPriceImportRow: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          // A compensating event already exists for the test row. The database
          // would omit it ONLY with this relation filter; otherwise this mock
          // fails closed instead of handing out a misleading clean result.
          expect(where).toMatchObject({
            batchId,
            status: 'NEEDS_REVIEW',
            resolutionCompensations: { none: {} },
          });
          return [];
        }),
      },
      $transaction: jest.fn(),
    };
    const proposals = {
      proposeForRows: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new BasicPriceRowResolutionService(
      prisma as never,
      {} as never,
      {} as never,
      proposals as never,
      {} as never,
    );
    const answer = await service.acceptMachineProvenRows(
      workspaceId, batchId, reviewerId,
    );
    expect(answer).toMatchObject({
      acceptedCount: 0,
      eligibleCount: 0,
      skippedCount: 0,
      remainingEligible: 0,
    });
    expect(prisma.basicPriceImportRow.findMany).toHaveBeenCalledTimes(1);
    expect(proposals.proposeForRows).toHaveBeenCalledWith(
      workspaceId, [],
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

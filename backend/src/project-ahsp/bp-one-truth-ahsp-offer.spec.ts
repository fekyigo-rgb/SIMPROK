import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

describe('BP-ONE-TRUTH-01 — same observed offer reaches AHSP candidate read', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000004';
  const predecessorId = '11111111-1111-4111-8111-111111111111';
  const descendantId = '22222222-2222-4222-8222-222222222222';

  const run = async (accepted: boolean) => {
    const eligibility = new BasicPriceEligibilityPolicy();
    const identity = {
      loadEvidence: jest.fn().mockResolvedValue({
        catalogCandidates: [],
        sourceSightings: [],
        reviewedMappings: [],
      }),
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ predecessorId, descendantId, depth: 1 }])
        .mockResolvedValueOnce([]),
      basicPrice: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(accepted ? [{ id: descendantId }] : [])
          .mockResolvedValueOnce([]),
      },
    };
    const orchestrator = new AhspResourceResolutionOrchestrator(
      eligibility,
      {} as never,
      identity as never,
    );
    await orchestrator.resolveVersionResources(tx, {
      workspaceId,
      projectId: 'project-preview',
      referenceRegionId: 'region-preview',
      asOf: new Date('2026-10-10T00:00:00.000Z'),
      version: { id: 'version-preview', resources: [] },
    });
    return tx;
  };

  it('filters old ID BEFORE the existing AHSP price resolver receives candidates', async () => {
    const tx = await run(true);
    expect(tx.basicPrice.findMany).toHaveBeenCalledTimes(2);
    const [eligibleArgs] = tx.basicPrice.findMany.mock.calls[0] as [
      { where: { id: { in: string[] } } },
    ];
    expect(eligibleArgs.where.id.in).toEqual([descendantId]);
    const [offerArgs] = tx.basicPrice.findMany.mock.calls[1] as [
      { where: { id: { notIn: string[] }; OR: unknown[] } },
    ];
    expect(offerArgs.where.id.notIn).toEqual([predecessorId]);
    expect(offerArgs.where.OR).toHaveLength(2);
  });

  it('does not suppress the old candidate when the new price is not eligible', async () => {
    const tx = await run(false);
    const [offerArgs] = tx.basicPrice.findMany.mock.calls[1] as [
      { where: { id?: { notIn: string[] } } },
    ];
    expect(offerArgs.where.id).toBeUndefined();
  });
});

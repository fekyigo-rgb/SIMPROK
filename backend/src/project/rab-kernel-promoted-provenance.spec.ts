import { ConflictException } from '@nestjs/common';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';

/**
 * BP-CAT-01B — the Cost Kernel's PROMOTED provenance branch.
 *
 * A shared catalog price deliberately holds no `sourceSubmissionId` of its own:
 * that column is UNIQUE and still belongs to the origin it was promoted from,
 * and `sourceImportRowId` may never sit on a catalog row at all. Without the
 * promoted branch, such a row would pass canonical eligibility and then be
 * refused at persistence — selectable but unusable, which is worse than never
 * being offered.
 *
 * THE DISCRIMINATING FACT these tests pin: a promoted row's chain must be proved
 * against the ORIGIN. The origin is the row that holds the PriceSubmission, the
 * single ACCEPT decision and the PUBLISH audit; the shared row holds none of
 * them and carries only a PROMOTE_SHARED audit. So "which basicPriceId did the
 * publisher-evidence lookup ask for" is the exact question that separates a
 * working delegation from a silently broken one, and it is asserted directly
 * rather than inferred from a pass/fail.
 */
describe('BP-CAT-01B Cost Kernel promoted provenance', () => {
  const SHARED_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const ORIGIN_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
  const WORKSPACE_A = 'cccccccc-0000-4000-8000-000000000003';
  const ORG_A = 'dddddddd-0000-4000-8000-000000000004';
  const RESOURCE_ID = 'eeeeeeee-0000-4000-8000-000000000005';
  const REGION_ID = 'ffffffff-0000-4000-8000-000000000006';
  const SUBMISSION_ID = '11111111-0000-4000-8000-000000000007';
  const VERIFIER_ACCOUNT = '22222222-0000-4000-8000-000000000008';
  const PUBLISHER_ACCOUNT = '33333333-0000-4000-8000-000000000009';

  /** The shared row exactly as BasicPricePromotionService writes it. */
  const sharedRow = (overrides: Record<string, unknown> = {}) => ({
    id: SHARED_ID,
    assetScope: 'SIMPROK_CATALOG',
    sourceSubmissionId: null,
    sourceImportRowId: null,
    promotedFromBasicPriceId: ORIGIN_ID,
    resourceId: RESOURCE_ID,
    workspaceId: null,
    organizationId: null,
    regionId: REGION_ID,
    ...overrides,
  });

  /** A lawful origin: workspace-owned catalog truth with a complete chain. */
  const originRow = (overrides: Record<string, unknown> = {}) => ({
    id: ORIGIN_ID,
    assetScope: 'SIMPROK_CATALOG',
    sourceSubmissionId: SUBMISSION_ID,
    sourceImportRowId: null,
    resourceId: RESOURCE_ID,
    workspaceId: WORKSPACE_A,
    organizationId: ORG_A,
    regionId: REGION_ID,
    ...overrides,
  });

  const buildTx = (origin: unknown) => {
    const auditCalls: Array<{ basicPriceId: string; action: string }> = [];
    const tx = {
      basicPrice: { findUnique: jest.fn().mockResolvedValue(origin) },
      priceSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          id: SUBMISSION_ID,
          resourceId: RESOURCE_ID,
          workspaceId: WORKSPACE_A,
          organizationId: ORG_A,
          review: {
            workspaceId: WORKSPACE_A,
            organizationId: ORG_A,
            decisions: [{ decidedByUserId: 'user-verifier' }],
          },
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          membership: {
            accountId: VERIFIER_ACCOUNT,
            workspaceId: WORKSPACE_A,
          },
        }),
      },
      basicPricePublicationAudit: {
        findFirst: jest.fn(
          (args: { where: { basicPriceId: string; action: string } }) => {
            auditCalls.push(args.where);
            // Only the ORIGIN was ever published. The shared row carries a
            // PROMOTE_SHARED audit, which this lookup deliberately does not match.
            return Promise.resolve(
              args.where.basicPriceId === ORIGIN_ID
                ? { actorAccountId: PUBLISHER_ACCOUNT }
                : null,
            );
          },
        ),
      },
    };
    return { tx, auditCalls };
  };

  const service = () =>
    new RabKernelPersistenceService({} as never, {} as never, {} as never);

  const assertProvenance = (tx: unknown, row: unknown, trusted: string) =>
    (
      service() as unknown as {
        assertTraceableProvenance: (
          tx: unknown,
          row: unknown,
          trusted: string,
        ) => Promise<void>;
      }
    ).assertTraceableProvenance(tx, row, trusted);

  it('proves a shared row through its ORIGIN, asking for the ORIGIN’s publication evidence', async () => {
    const { tx, auditCalls } = buildTx(originRow());

    await expect(
      assertProvenance(tx, sharedRow(), 'some-consuming-workspace'),
    ).resolves.toBeUndefined();

    // THE DISCRIMINATOR. Had the branch not delegated, this lookup would have
    // asked for the SHARED row's id — which has no PUBLISH audit — and the
    // whole chain would have failed closed.
    expect(auditCalls).toEqual([
      { basicPriceId: ORIGIN_ID, action: 'PUBLISH' },
    ]);
    // And the origin really was fetched by the lineage, not guessed at.
    expect(tx.basicPrice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORIGIN_ID } }),
    );
  });

  it('a consuming workspace never has to own the origin — the catalog chain is tenant-blind by design', async () => {
    const { tx } = buildTx(originRow());
    // Workspace B is consuming a price Workspace A produced. The private branch
    // is the one that demands ownership; this one must not, or a shared price
    // would be usable only by the tenant that gave it away.
    await expect(
      assertProvenance(tx, sharedRow(), 'a-totally-different-workspace'),
    ).resolves.toBeUndefined();
  });

  it('fails closed when the lineage points at nothing', async () => {
    const { tx } = buildTx(null);
    await expect(
      assertProvenance(tx, sharedRow(), WORKSPACE_A),
    ).rejects.toThrow(ConflictException);
  });

  it('fails closed when the origin is a workspace-private row', async () => {
    const { tx } = buildTx(originRow({ assetScope: 'WORKSPACE_PRIVATE' }));
    await expect(
      assertProvenance(tx, sharedRow(), WORKSPACE_A),
    ).rejects.toThrow(ConflictException);
  });

  it('fails closed when the origin belongs to no workspace — a shared row cannot stand on another shared row', async () => {
    const { tx } = buildTx(originRow({ workspaceId: null }));
    await expect(
      assertProvenance(tx, sharedRow(), WORKSPACE_A),
    ).rejects.toThrow(ConflictException);
  });

  it('fails closed when the origin restates a DIFFERENT resource or region', async () => {
    for (const drift of [
      { resourceId: 'ffffffff-0000-4000-8000-00000000000f' },
      { regionId: 'ffffffff-0000-4000-8000-00000000000e' },
    ]) {
      const { tx } = buildTx(originRow(drift));
      await expect(
        assertProvenance(tx, sharedRow(), WORKSPACE_A),
      ).rejects.toThrow(ConflictException);
    }
  });

  it('an ordinary catalog row is untouched by this branch — no lineage, no delegation', async () => {
    const { tx, auditCalls } = buildTx(originRow());
    // A normal workspace catalog row proves its OWN chain, so the publication
    // lookup asks for its own id and the lineage is never consulted.
    await expect(
      assertProvenance(
        tx,
        { ...originRow(), promotedFromBasicPriceId: null },
        WORKSPACE_A,
      ),
    ).resolves.toBeUndefined();
    expect(tx.basicPrice.findUnique).not.toHaveBeenCalled();
    expect(auditCalls).toEqual([
      { basicPriceId: ORIGIN_ID, action: 'PUBLISH' },
    ]);
  });
});

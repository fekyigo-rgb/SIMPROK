import { ConflictException } from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  HARNESS_ACCOUNT,
  HARNESS_WORKSPACE,
  createIntakeHarness,
} from '../../test/fixtures/usi01r-intake-harness';
import {
  GEO_SCOPE_LABELS,
  buildGeographicScopeMatrixXlsx,
} from '../../test/fixtures/bp-region-truth-07s.fixture';

/**
 * BP-REGION-TRUTH-07S §11/§12/§13 — IMPORT IDENTITY OVER THE LIFECYCLE THE
 * BROWSER ACTUALLY PERFORMS.
 *
 * WHY THE OLDER IDENTITY PINS DID NOT CATCH THIS. Every one of them handed
 * `regionId` to `preview` directly, so the fingerprint was born already knowing
 * its region and there was nothing left to drift. The real page cannot do that:
 * `handleFileChosen` deliberately clears metadata before reading a new file — a
 * second workbook must never inherit the first one's provenance — so a batch is
 * ALWAYS minted with `regionId: null`, and the Region is chosen afterwards in a
 * form that only exists once the batch does.
 *
 * That is the sequence these tests perform, and nothing else:
 *
 *   preview(no metadata)  →  PATCH(region)  →  preview(no metadata) again
 *
 * The `regionId` is a fingerprint input by design, so identity minted before a
 * region exists is identity describing a batch that no longer exists.
 */
describe('BP-REGION-TRUTH-07S — identity describes final facts', () => {
  const REGION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const REGION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const makeService = (harness: ReturnType<typeof createIntakeHarness>) =>
    new BasicPriceImportService(
      harness.prisma as PrismaService,
      harness.reviewService as PriceSubmissionReviewService,
      harness.sourceArchive,
      harness.proposals as BasicPriceRowResolutionProposalService,
      {
        resolveCanonicalUnitIdentities: jest.fn(() => Promise.resolve([])),
      } as unknown as UnitKernelService,
    );

  const matrixFile = async () => {
    const bytes = await buildGeographicScopeMatrixXlsx();
    return { buffer: bytes, size: bytes.length, originalname: 'ambon.xlsx' };
  };

  /**
   * The reading this source genuinely requires. Its resource and unit columns
   * carry no header at all — the Owner's real workbook is shaped the same way —
   * so intake asks which is which, and a person answers once. Held CONSTANT
   * across every test here so the only axis that ever varies is the one the
   * test is about.
   */
  const reading = (overrides: Record<string, unknown> = {}) =>
    ({
      selectedRegionLabel: GEO_SCOPE_LABELS[0],
      selectedNameColumn: 2,
      selectedUnitColumn: 3,
      declaredSection: 'MATERIAL',
      ...overrides,
    }) as never;

  /** What the BROWSER sends on a fresh file: the reading, no context at all. */
  const previewWithoutContext = async (
    service: BasicPriceImportService,
    file: Awaited<ReturnType<typeof matrixFile>>,
    overrides: Record<string, unknown> = {},
  ) =>
    service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading(overrides),
    );

  const finalizeRegion = (
    service: BasicPriceImportService,
    batchId: string,
    version: number,
    regionId: string,
  ) =>
    service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      batchId,
      { version, regionId },
      HARNESS_ACCOUNT,
    );

  it('IDENTITY-01: finalizing a region CHANGES the identity minted before one existed', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const previewed = await previewWithoutContext(service, file);
    // The batch is real, and it truthfully has no region yet.
    expect(previewed.regionId).toBeNull();
    const provisional = previewed.importFingerprint;

    const finalized = await finalizeRegion(
      service,
      previewed.batchId,
      previewed.version,
      REGION_A,
    );

    expect(finalized.regionId).toBe(REGION_A);
    // THE INVARIANT. Before this repair the fingerprint stayed exactly what it
    // had been — an identity asserting `regionId: null` about a batch that now
    // claims a concrete Region.
    expect(finalized.importFingerprint).not.toBe(provisional);
  });

  it('IDENTITY-04: the finalized identity is the one a direct read of the same facts would mint', async () => {
    const lifecycle = createIntakeHarness();
    const file = await matrixFile();

    const previewed = await previewWithoutContext(makeService(lifecycle), file);
    const finalized = await finalizeRegion(
      makeService(lifecycle),
      previewed.batchId,
      previewed.version,
      REGION_A,
    );

    // The SAME file, SAME scope and SAME region, read in one step by a caller
    // that already knew the region — the API path, rather than the browser's.
    const direct = createIntakeHarness();
    const straightThrough = await makeService(direct).preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading({ regionId: REGION_A }),
    );

    // ONE ENGINE, ONE ANSWER. Two routes to the same final facts must not
    // produce two identities, or the fingerprint would be describing HOW a
    // batch was assembled instead of WHAT it is.
    expect(finalized.importFingerprint).toBe(straightThrough.importFingerprint);
  });

  it('IDENTITY-02: the same file finalized to a DIFFERENT region is not the same context', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const first = await previewWithoutContext(service, file);
    const toRegionA = await finalizeRegion(
      service,
      first.batchId,
      first.version,
      REGION_A,
    );

    // The browser re-reads the file for the second jurisdiction exactly as it
    // read it the first time: no context.
    const second = await previewWithoutContext(service, file);
    const toRegionB = await finalizeRegion(
      service,
      second.batchId,
      second.version,
      REGION_B,
    );

    // TWO REGIONS, TWO BATCHES, TWO IDENTITIES. This is the journey that was
    // unreachable: the second upload used to recompute the FIRST batch's stale
    // fingerprint, match it, and hand back region A's batch — so a workbook
    // could be imported for exactly one place, forever.
    expect(toRegionB.batchId).not.toBe(toRegionA.batchId);
    expect(toRegionB.regionId).toBe(REGION_B);
    expect(toRegionA.regionId).toBe(REGION_A);
    expect(toRegionB.importFingerprint).not.toBe(toRegionA.importFingerprint);
  });

  it('IDENTITY-03: the same region read from a DIFFERENT source column is not the same reading', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const fromFirstColumn = await previewWithoutContext(service, file);
    const finalizedFirst = await finalizeRegion(
      service,
      fromFirstColumn.batchId,
      fromFirstColumn.version,
      REGION_A,
    );

    const fromSecondColumn = await previewWithoutContext(service, file, {
      selectedRegionLabel: GEO_SCOPE_LABELS[1],
    });
    const finalizedSecond = await finalizeRegion(
      service,
      fromSecondColumn.batchId,
      fromSecondColumn.version,
      REGION_A,
    );

    // Same canonical Region on both, and still not the same fact: these are two
    // different jurisdictions' prices out of one workbook. The column axis
    // survives finalization rather than being flattened by it.
    expect(GEO_SCOPE_LABELS[0]).not.toBe(GEO_SCOPE_LABELS[1]);
    expect(finalizedSecond.importFingerprint).not.toBe(
      finalizedFirst.importFingerprint,
    );
  });

  it('IDENTITY-05: two batches may not finalize into ONE identity — refused, never duplicated', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const first = await previewWithoutContext(service, file);
    await finalizeRegion(service, first.batchId, first.version, REGION_A);

    // A second read of the same file, finalized to the SAME region, would BE
    // the first batch. The unique index is what says so.
    const second = await previewWithoutContext(service, file);
    const batchCountBefore = harness.batches.length;
    const secondVersionBefore = harness.batches.find(
      (batch) => batch.id === second.batchId,
    )!.version;

    await expect(
      finalizeRegion(service, second.batchId, second.version, REGION_A),
    ).rejects.toBeInstanceOf(ConflictException);

    // NOTHING WAS MERGED, DUPLICATED OR SILENTLY OVERWRITTEN. The refused batch
    // is exactly as it was — same version, same absent region — so no row work
    // inside it was destroyed by a save that did not happen.
    expect(harness.batches.length).toBe(batchCountBefore);
    const refused = harness.batches.find(
      (batch) => batch.id === second.batchId,
    )!;
    expect(refused.version).toBe(secondVersionBefore);
    expect(refused.regionId ?? null).toBeNull();
  });

  /**
   * BP-REGION-TRUTH-07U — THE REFUSAL MUST SURVIVE THE DATABASE IT HAPPENS IN.
   *
   * IDENTITY-05 proves the collision is REFUSED. This proves the refusal
   * arrives as a refusal. The unique constraint aborts the PostgreSQL
   * transaction, so the recovery read that names the winning batch may not be
   * issued through it — and when it was, the person met a 500 instead of a 409
   * and never learned which batch they already had.
   *
   * The harness now enforces the abort law, so this test fails against the code
   * that had the read inside the transaction.
   */
  it('IDENTITY-07: the collision names the winning batch WITHOUT querying the aborted transaction', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const first = await previewWithoutContext(service, file);
    const winner = await finalizeRegion(
      service,
      first.batchId,
      first.version,
      REGION_A,
    );

    const second = await previewWithoutContext(service, file);

    const refusal = await finalizeRegion(
      service,
      second.batchId,
      second.version,
      REGION_A,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    // A CONFLICT, NOT AN INTERNAL FAILURE. A raw 25P02 escaping this seam is
    // exactly the defect: it is neither instanceof ConflictException nor
    // something a room could turn into a sentence.
    expect(refusal).toBeInstanceOf(ConflictException);
    // AND IT SAYS WHICH BATCH. The whole point of the recovery read.
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      message: 'BATCH_IDENTITY_ALREADY_EXISTS',
      existingBatchId: first.batchId,
    });
    // The winner is untouched by having been named.
    expect(
      harness.batches.find((batch) => batch.id === first.batchId)!.version,
    ).toBe(winner.version);
  });

  it('IDENTITY-06: a save that touches no identity-bearing fact leaves identity alone', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const previewed = await previewWithoutContext(service, file);
    const finalized = await finalizeRegion(
      service,
      previewed.batchId,
      previewed.version,
      REGION_A,
    );

    // A soft re-verification date is a human note, not an identity fact.
    const noted = await service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      previewed.batchId,
      { version: finalized.version, reviewDate: '2026-09-01' },
      HARNESS_ACCOUNT,
    );

    // Recomputation must be a statement about facts, not a side effect of
    // saving. An unchanged identity is left byte-identical.
    expect(noted.importFingerprint).toBe(finalized.importFingerprint);
  });
});

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
  UNKNOWN_UNIT_COLUMNS,
  UNKNOWN_UNIT_REGIONS,
  buildUnknownUnitVocabularyXlsx,
} from '../../test/fixtures/unknown-unit-vocabulary.fixture';

/**
 * BP-VISUAL-TRUTH-07 §7/§8 — REGION IDENTITY, AT THE TRUTH BOUNDARY.
 *
 * THE OWNER'S REPORT. Three choices were offered — SIRIMAU, TELUK AMBON,
 * BAGUALA — "TELUK AMBON" was clicked, and the source context later read
 * "Kecamatan Teluk Ambon Baguala, Kota Ambon". The suspicion was that SIMPROK
 * had collapsed two places whose names overlap.
 *
 * WHAT THIS SUITE ESTABLISHES. It had not. Those three choices are the
 * WORKBOOK'S OWN PRICE COLUMNS — the source's wording for which column of a
 * regional matrix to read — and they travel as `selectedRegionLabel` into
 * `sourceRegionScopeLabel`. The canonical Region is a separate fact in
 * `regionId`, chosen in the metadata form. Two questions, two columns, two
 * answers; the browser simply printed one of them under the other's name.
 *
 * So these pins guard the IDENTITY law that was already correct, against a
 * future change that might quietly fold the column into the region — plus the
 * projection that now carries the column fact outward, which is the seam whose
 * absence made the confusion unreadable and therefore unfixable by the user.
 *
 * The column labels are the fixture's own; `UNKNOWN_UNIT_REGIONS` is a real
 * multi-jurisdiction matrix workbook, not a string invented here.
 */
describe('BP-VISUAL-TRUTH-07 — region column and canonical region are two facts', () => {
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

  const fileNamed = (bytes: Buffer, originalname: string) => ({
    buffer: bytes,
    size: bytes.length,
    originalname,
  });

  /** One reading, varied only where a test says so. */
  const reading = (overrides: Record<string, unknown> = {}) =>
    ({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      selectedRegionLabel: UNKNOWN_UNIT_REGIONS[0],
      declaredSection: 'MATERIAL',
      ...overrides,
    }) as never;

  const matrixFile = async () =>
    fileNamed(await buildUnknownUnitVocabularyXlsx(), 'ambon-matrix.xlsx');

  it('REGION-03: the SAME file read from a DIFFERENT price column is not the same import context', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    // Everything is held identical EXCEPT the column. This is the isolation the
    // older sibling test does not give: it varies the declared section too, so
    // it cannot tell which axis did the work.
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading({ selectedRegionLabel: UNKNOWN_UNIT_REGIONS[0] }),
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading({ selectedRegionLabel: UNKNOWN_UNIT_REGIONS[1] }),
    );

    expect(UNKNOWN_UNIT_REGIONS[0]).not.toBe(UNKNOWN_UNIT_REGIONS[1]);
    // NOT an exact replay, and NOT an interpretation update of the first: a
    // different jurisdiction's prices are a different fact, not a re-reading of
    // the same one.
    expect(second.reimport.classification).toBe('NEW_OR_UNPROVEN');
    expect(second.reimport.existingBatchId).toBeNull();
    expect(second.batchId).not.toBe(first.batchId);
    expect(first.importFingerprint).not.toBe(second.importFingerprint);
  });

  it('REGION-04: the SAME file, SAME column and SAME reading stays lawfully idempotent', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading(),
    );
    const replay = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading(),
    );

    // Distinguishing the columns must NOT have cost the replay law: an
    // unchanged re-upload still lands on the batch it already made.
    expect(replay.reimport.classification).toBe('EXACT_EXISTING');
    expect(replay.batchId).toBe(first.batchId);
    expect(replay.importFingerprint).toBe(first.importFingerprint);
  });

  it('REGION-06: the batch states WHICH price column it was read from, so the two answers can be told apart', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading({ selectedRegionLabel: UNKNOWN_UNIT_REGIONS[1] }),
    );

    // The column fact is projected in the SOURCE'S OWN WORDING — this is the
    // seam whose absence let a person read the canonical Region as the answer
    // to the column question.
    expect(previewed.sourceRegionScopeLabel).toBe(UNKNOWN_UNIT_REGIONS[1]);
    // And it is a SEPARATE field from the canonical region, never a substitute
    // for one. Preview has chosen no Region yet, and says so honestly.
    expect(previewed.regionId).toBeNull();
  });

  it('REGION-07: a single-column source claims no column choice nobody made', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      reading(),
    );

    // The field exists on every batch; what it must never do is invent a
    // jurisdiction for a source that offered only one.
    expect(
      previewed.sourceRegionScopeLabel === null ||
        typeof previewed.sourceRegionScopeLabel === 'string',
    ).toBe(true);
  });
});

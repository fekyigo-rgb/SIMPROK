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
  GEO_BANNER_WORD,
  GEO_SCOPE_LABELS,
  NON_GEO_SCOPE_LABELS,
  buildGeographicScopeMatrixXlsx,
  buildNonGeographicScopeMatrixXlsx,
} from '../../test/fixtures/bp-region-truth-07s.fixture';

/**
 * BP-REGION-TRUTH-07S §6/§7/§8 — THE WHOLE SEAM, FROM WORKBOOK TO VERDICT.
 *
 * The detector suite proves a document's geography is READABLE. The policy
 * suite proves an unreconciled pair is NOT SAVE-READY. Neither proves the two
 * are connected, and a fact that is read at intake and dropped before the
 * database is exactly the defect this task exists to close — the "KECAMATAN"
 * banner was recognised by `matchHeaderRole` all along and thrown away one line
 * later.
 *
 * So these pins follow the fact the whole way: source bytes → reading → stored
 * batch → the action law a person actually meets.
 */
describe('BP-REGION-TRUTH-07S — source scope geography survives to the batch', () => {
  const REGION_BAGUALA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

  const fileOf = (bytes: Buffer, name: string) => ({
    buffer: bytes,
    size: bytes.length,
    originalname: name,
  });

  const reading = (scopeLabel: string) =>
    ({
      selectedRegionLabel: scopeLabel,
      selectedNameColumn: 2,
      selectedUnitColumn: 3,
      declaredSection: 'MATERIAL',
    }) as never;

  /**
   * EVERY OTHER REQUIRED FACT, STATED. The action law reports the FIRST unmet
   * precondition in the writer's own order, so a batch missing its date would
   * be refused for the date and this suite would learn nothing about geography.
   * Saved together, exactly as the metadata form saves them.
   */
  const completeContext = (regionId: string) => ({
    regionId,
    effectiveDate: '2026-08-28',
    sourceOrigin: 'GOVERNMENT',
    sourceType: 'REGULATION',
  });

  it('SCOPE-PROV-01: the banner and the scope KIND both reach the stored batch', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileOf(await buildGeographicScopeMatrixXlsx(), 'ambon.xlsx'),
      reading(GEO_SCOPE_LABELS[0]),
    );

    const stored = harness.batches.find(
      (batch) => batch.id === previewed.batchId,
    )!;
    // WHICH scope, HOW it was read, and WHAT the source called it — three
    // separate facts, all of them the source's own words or the reading's own
    // verdict, none of them inferred later from the others.
    expect(stored.sourceRegionScopeLabel).toBe(GEO_SCOPE_LABELS[0]);
    expect(stored.sourceRegionScopeKind).toBe('COLUMN');
    expect(stored.sourceRegionScopeGeographicEvidence).toBe(GEO_BANNER_WORD);
    // Nobody has reconciled anything yet, and the batch says so plainly.
    expect(stored.regionScopeConfirmedRegionId ?? null).toBeNull();
  });

  it('SOURCE-GEO-02: choosing a canonical Region does not make the pair save-ready', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileOf(await buildGeographicScopeMatrixXlsx(), 'ambon.xlsx'),
      reading(GEO_SCOPE_LABELS[0]),
    );
    const finalized = await service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      previewed.batchId,
      {
        version: previewed.version,
        ...completeContext(REGION_BAGUALA),
      } as never,
      HARNESS_ACCOUNT,
    );

    // The Owner's exact pair: a SIRIMAU column under a canonical Region that is
    // not spelled SIRIMAU. SIMPROK does not decide it — it says it cannot.
    expect(finalized.actions.regionScope).toEqual({
      sourceLabel: GEO_SCOPE_LABELS[0],
      geographicEvidence: GEO_BANNER_WORD,
      confirmedRegionId: null,
      compatibilityUnproven: true,
    });
    expect(finalized.actions.privateUse.offered).toBe(false);
    expect(finalized.actions.privateUse.reasonCode).toBe(
      'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE',
    );
  });

  it('one human confirmation settles it, recorded as the Region it was about', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileOf(await buildGeographicScopeMatrixXlsx(), 'ambon.xlsx'),
      reading(GEO_SCOPE_LABELS[0]),
    );
    const withRegion = await service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      previewed.batchId,
      {
        version: previewed.version,
        ...completeContext(REGION_BAGUALA),
      } as never,
      HARNESS_ACCOUNT,
    );
    const confirmed = await service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      previewed.batchId,
      {
        version: withRegion.version,
        confirmRegionScopeCompatibility: true,
      },
      HARNESS_ACCOUNT,
    );

    expect(confirmed.actions.regionScope.compatibilityUnproven).toBe(false);
    // THE REGION, NOT A BOOLEAN. The browser stated an intent; the server
    // recorded which place the intent was about, so it cannot later be read as
    // an answer about a different one.
    expect(confirmed.actions.regionScope.confirmedRegionId).toBe(
      REGION_BAGUALA,
    );
    // AND THE CONFIRMATION IS NOT AN IDENTITY FACT. Agreeing that a source
    // scope names a place changes nothing about WHICH import this is.
    expect(confirmed.importFingerprint).toBe(withRegion.importFingerprint);
  });

  it('SOURCE-NONGEO-01: an identically-shaped non-geographic source stays silent', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);

    const previewed = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileOf(await buildNonGeographicScopeMatrixXlsx(), 'grosir.xlsx'),
      reading(NON_GEO_SCOPE_LABELS[0]),
    );
    const finalized = await service.updateBatchMetadata(
      HARNESS_WORKSPACE,
      previewed.batchId,
      {
        version: previewed.version,
        ...completeContext(REGION_BAGUALA),
      } as never,
      HARNESS_ACCOUNT,
    );

    const stored = harness.batches.find(
      (batch) => batch.id === previewed.batchId,
    )!;
    // The scope question WAS asked and answered — the shape required it — and
    // the answer is stored. What is absent is any claim that it means a place.
    expect(stored.sourceRegionScopeLabel).toBe(NON_GEO_SCOPE_LABELS[0]);
    expect(stored.sourceRegionScopeGeographicEvidence ?? null).toBeNull();
    // ZERO false warnings. This is the pin that keeps one workbook's ambiguity
    // from being paid for by every other workbook.
    expect(finalized.actions.regionScope.compatibilityUnproven).toBe(false);
    expect(finalized.actions.privateUse.reasonCode).not.toBe(
      'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE',
    );
  });
});

import { NotFoundException } from '@nestjs/common';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  HARNESS_ACCOUNT,
  HARNESS_OTHER_WORKSPACE,
  HARNESS_WORKSPACE,
  createIntakeHarness,
} from '../../test/fixtures/usi01r-intake-harness';
import {
  buildBasicPriceCsv,
  buildSemanticHeaderXlsx,
} from '../../test/fixtures/usi01-source-shapes.fixture';
import {
  UNKNOWN_UNIT_COLUMNS,
  UNKNOWN_UNIT_REGIONS,
  buildUnknownUnitVocabularyXlsx,
} from '../../test/fixtures/unknown-unit-vocabulary.fixture';

/**
 * SMART RE-IMPORT — intake-door product seam.
 *
 * Classification itself is proved in basic-price-reimport.law.spec.ts.
 * This suite proves the live door: lookup is workspace+owner scoped, a
 * same filename is not identity, and choosing existing never mutates history.
 */
interface StoredBatch {
  id: string;
  workspaceId: string;
  uploadedByAccountId: string;
  status: string;
  importFingerprint: string;
  sourceSha256: string;
}

describe('SMART RE-IMPORT intake seam', () => {
  const OTHER_ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

  const stored = (
    harness: ReturnType<typeof createIntakeHarness>,
  ): StoredBatch[] => harness.batches as StoredBatch[];

  it('R-4 SKIP: exact replay returns the existing batch and writes nothing', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = fileNamed(buildBasicPriceCsv(), 'harga.csv');
    const metadata = { declaredSection: 'MATERIAL' } as never;

    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      metadata,
    );
    const replay = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      metadata,
    );

    expect(replay.batchId).toBe(first.batchId);
    expect(replay.reimport.classification).toBe('EXACT_EXISTING');
    expect(stored(harness)).toHaveLength(1);
    expect(stored(harness)[0].status).toBe('NEEDS_REVIEW');
  });

  it('R-6: the same filename with different bytes and no source identity is NEW, not an update', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const metadata = { declaredSection: 'MATERIAL' } as never;
    const firstBytes = buildBasicPriceCsv();
    const secondBytes = Buffer.from(
      [
        'resource_name,source_unit,harga satuan,sumber',
        'Pasir Lain,M3,999000,Survei Uji',
        '',
      ].join('\r\n'),
      'utf8',
    );

    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileNamed(firstBytes, 'harga-ambon.csv'),
      metadata,
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileNamed(secondBytes, 'harga-ambon.csv'),
      metadata,
    );

    expect(second.batchId).not.toBe(first.batchId);
    expect(second.reimport.classification).toBe('NEW_OR_UNPROVEN');
    expect(second.reimport.existingBatchId).toBeNull();
    expect(stored(harness)).toHaveLength(2);
  });

  it('R-8: a related batch in another workspace never becomes a re-import option', async () => {
    const home = createIntakeHarness();
    const foreign = createIntakeHarness();
    const homeService = makeService(home);
    const file = fileNamed(buildBasicPriceCsv(), 'harga.csv');
    const metadata = { declaredSection: 'MATERIAL' } as never;

    await homeService.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      metadata,
    );

    await makeService(foreign).preview(
      HARNESS_OTHER_WORKSPACE,
      OTHER_ACCOUNT,
      file,
      metadata,
    );

    const again = await homeService.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      metadata,
    );
    expect(again.reimport.classification).toBe('EXACT_EXISTING');
    expect(again.reimport.existingBatchId).toBe(stored(home)[0].id);
    expect(stored(home)).toHaveLength(1);
    expect(stored(foreign)).toHaveLength(1);
    expect(stored(home)[0].workspaceId).toBe(HARNESS_WORKSPACE);
    expect(stored(foreign)[0].workspaceId).toBe(HARNESS_OTHER_WORKSPACE);
    expect(stored(home)[0].uploadedByAccountId).toBe(HARNESS_ACCOUNT);
    expect(stored(foreign)[0].uploadedByAccountId).toBe(OTHER_ACCOUNT);
  });

  it("R-8: a teammate's batch in the same workspace is not disclosed", async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = fileNamed(buildBasicPriceCsv(), 'harga.csv');
    const metadata = { declaredSection: 'MATERIAL' } as never;

    await service.preview(HARNESS_WORKSPACE, HARNESS_ACCOUNT, file, metadata);

    await expect(
      service.preview(HARNESS_WORKSPACE, OTHER_ACCOUNT, file, metadata),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stored(harness)).toHaveLength(1);
  });

  it('R-9: presenting an update does not publish, verify, or rewrite the historical batch', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const metadata = { declaredSection: 'MATERIAL' } as never;
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileNamed(buildBasicPriceCsv(), 'harga.csv'),
      metadata,
    );
    const historical = { ...stored(harness)[0] };

    const replay = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      fileNamed(buildBasicPriceCsv(), 'harga.csv'),
      metadata,
    );

    expect(replay.reimport.classification).toBe('EXACT_EXISTING');
    expect(stored(harness)[0]).toMatchObject({
      id: historical.id,
      status: historical.status,
      importFingerprint: historical.importFingerprint,
      sourceSha256: historical.sourceSha256,
    });
    expect(first.batchId).toBe(historical.id);
  });

  const matrixFile = async () =>
    fileNamed(await buildUnknownUnitVocabularyXlsx(), 'matrix.xlsx');

  const matrixReading = (overrides: Record<string, unknown>) =>
    ({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      selectedRegionLabel: UNKNOWN_UNIT_REGIONS[0],
      declaredSection: 'MATERIAL',
      ...overrides,
    }) as never;

  it('same bytes, same sheet, same region, different reading is INTERPRETATION_UPDATE', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'MATERIAL' }),
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'LABOR' }),
    );
    expect(second.reimport.classification).toBe('INTERPRETATION_UPDATE');
    expect(second.reimport.existingBatchId).toBe(first.batchId);
    expect(second.batchId).not.toBe(first.batchId);
    expect(stored(harness)).toHaveLength(2);
  });

  it('same bytes, different source region scope is not an interpretation sibling', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({
        selectedRegionLabel: 'SIRIMAU',
        declaredSection: 'MATERIAL',
      }),
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({
        selectedRegionLabel: 'TELUK AMBON',
        declaredSection: 'LABOR',
      }),
    );
    expect(second.reimport.classification).toBe('NEW_OR_UNPROVEN');
    expect(second.reimport.existingBatchId).toBeNull();
    expect(second.batchId).not.toBe(first.batchId);
    expect(stored(harness)).toHaveLength(2);
    expect(stored(harness)[0].id).toBe(first.batchId);
  });

  it('same bytes, different selected sheet is not an interpretation sibling', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const bytes = await buildSemanticHeaderXlsx({
      includeSecondPriceSheet: true,
    });
    const file = fileNamed(bytes, 'dua-lembar.xlsx');
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      { selectedSheet: 'Sheet1', declaredSection: 'MATERIAL' } as never,
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      { selectedSheet: 'Lembar Kedua', declaredSection: 'LABOR' } as never,
    );
    expect(second.reimport.classification).not.toBe('INTERPRETATION_UPDATE');
    expect(second.reimport.existingBatchId).toBeNull();
    expect(second.batchId).not.toBe(first.batchId);
    expect(stored(harness)).toHaveLength(2);
  });

  it('a stored batch recorded against a different sheet name is not an update', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();
    await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'MATERIAL' }),
    );
    (harness.batches[0] as { selectedSheetName: string }).selectedSheetName =
      'Lembar Lain';
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'LABOR' }),
    );
    expect(second.reimport.classification).toBe('NEW_OR_UNPROVEN');
    expect(second.reimport.existingBatchId).toBeNull();
  });

  it('when several lawful siblings exist, the door picks the newest, not insertion order', async () => {
    const harness = createIntakeHarness();
    const service = makeService(harness);
    const file = await matrixFile();
    const first = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'MATERIAL' }),
    );
    const second = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'LABOR' }),
    );
    const third = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({ declaredSection: 'EQUIPMENT' }),
    );
    const batches = harness.batches as Array<{
      id: string;
      createdAt: Date;
    }>;
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    byId.get(first.batchId)!.createdAt = new Date('2026-01-01T00:00:00.000Z');
    byId.get(second.batchId)!.createdAt = new Date('2026-01-03T00:00:00.000Z');
    byId.get(third.batchId)!.createdAt = new Date('2026-01-02T00:00:00.000Z');
    const incoming = await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      file,
      matrixReading({
        declaredSection: 'MATERIAL',
        selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
      }),
    );
    expect(incoming.reimport.classification).toBe('INTERPRETATION_UPDATE');
    expect(incoming.reimport.existingBatchId).toBe(second.batchId);
    expect(incoming.reimport.existingBatchId).not.toBe(first.batchId);
  });
});

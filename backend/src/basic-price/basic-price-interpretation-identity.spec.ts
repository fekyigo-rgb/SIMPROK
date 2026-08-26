import { Test, TestingModule } from '@nestjs/testing';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { BasicPriceSourceArchiveService } from './basic-price-source-archive.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';
import {
  UNKNOWN_UNIT_COLUMNS,
  UNKNOWN_UNIT_REGIONS,
  buildUnknownUnitVocabularyXlsx,
} from '../../test/fixtures/unknown-unit-vocabulary.fixture';

/**
 * THE SAME BYTES READ WITH A DIFFERENT LAWFUL INTERPRETATION ARE NOT THE SAME
 * IMPORT TRUTH.
 *
 * THE DEFECT THIS SUITE CLOSES WAS NOT THEORETICAL. The Owner's workbook was
 * accepted once with its resource-name column answered as the unit column: 934
 * poisoned rows, every row wearing its own name as a unit, not one identity pair
 * closable. Answered honestly the SAME FILE yields 894 truthful rows. The
 * fingerprint looked at the digest, the sheet, the parser contract, the region
 * and the metadata — every one of which is identical across those two readings —
 * so the corrected import matched the poisoned batch and was handed the poison
 * back as an idempotent replay. THE DEFECT COULD NOT BE REPAIRED FROM OUTSIDE.
 *
 * WHAT MAKES THIS DIFFERENT FROM SIMPLY ADDING TWO FIELDS. Identity must fork on
 * a different READING, never on a differently-worded REQUEST. A workbook that
 * states its own column headers admits exactly one lawful reading of them, so a
 * stray `selectedNameColumn` sent alongside it decided nothing — and if that
 * forked the fingerprint, SIMPROK would mint duplicate batches for one truth,
 * which is the opposite failure and just as bad. Both directions are asserted
 * here.
 *
 * LEGACY BYTE-IDENTITY IS PROVED ELSEWHERE AND DELIBERATELY NOT DUPLICATED:
 * `basic-price-usi01-architecture.spec.ts` reproduces the pre-USI-01 RM-02
 * formula verbatim and asserts a legacy sectioned workbook still hashes to it.
 * That test is the gate — if these segments ever leaked into a reading that
 * depended on no human answer, it fails.
 */
/** The batch row as written, narrowed to the facts this suite interrogates. */
interface CreatedBatchData {
  importFingerprint: string;
  interpretationResourceNameColumn: number | null;
  interpretationSourceUnitColumn: number | null;
  interpretationDeclaredSection: string | null;
  [field: string]: unknown;
}

describe('IMPORT SEMANTIC-INTERPRETATION IDENTITY', () => {
  let service: BasicPriceImportService;
  let created: { data: CreatedBatchData }[];

  const WORKSPACE_ID = 'ws-01';
  const ORGANIZATION_ID = 'org-01';
  const ACCOUNT_ID = 'account-01';

  let matrixBytes: Buffer;
  let sectionedBytes: Buffer;

  const upload = (bytes: Buffer, name: string) => ({
    buffer: bytes,
    size: bytes.length,
    originalname: name,
  });

  /** The matrix that needs a human to name its columns AND its family. */
  const previewMatrix = (selection: Partial<PreviewBasicPriceImportDto>) =>
    service.preview(
      WORKSPACE_ID,
      ACCOUNT_ID,
      upload(matrixBytes, 'matrix.xlsx'),
      {
        declaredSection: 'MATERIAL',
        selectedRegionLabel: UNKNOWN_UNIT_REGIONS[0],
        selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
        selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
        ...selection,
      },
    );

  const fingerprintOf = (index = 0): string =>
    created[index].data.importFingerprint;

  const interpretationOf = (index = 0) => ({
    resourceNameColumn: created[index].data.interpretationResourceNameColumn,
    sourceUnitColumn: created[index].data.interpretationSourceUnitColumn,
    declaredSection: created[index].data.interpretationDeclaredSection,
  });

  beforeAll(async () => {
    matrixBytes = await buildUnknownUnitVocabularyXlsx();
    sectionedBytes = await buildBasicPriceXlsx();
  }, 60_000);

  beforeEach(async () => {
    created = [];
    const persisted: Record<string, Record<string, unknown>[]> = {};
    // A REAL FINGERPRINT INDEX, not a stub that always answers "nothing here".
    // Replay is the whole question in this suite, so the uniqueness the database
    // enforces is modelled rather than assumed away.
    const byFingerprint = new Map<string, CreatedBatchData & { id: string }>();
    const storedBatches: Array<CreatedBatchData & { id: string }> = [];
    let batchCounter = 0;

    const matchesWhere = (
      batch: CreatedBatchData & { id: string },
      where: Record<string, unknown> | undefined,
    ) =>
      Object.entries(where ?? {}).every(([field, value]) => {
        if (value && typeof value === 'object' && 'not' in value) {
          return (batch as Record<string, unknown>)[field] !== value.not;
        }
        return (batch as Record<string, unknown>)[field] === value;
      });

    const tx = {
      basicPriceImportBatch: {
        create: jest.fn((args: { data: CreatedBatchData }) => {
          created.push(args);
          const batch = {
            id: `batch-${++batchCounter}`,
            version: 0,
            createdAt: new Date(),
            ...args.data,
          };
          byFingerprint.set(args.data.importFingerprint, batch);
          storedBatches.push(batch);
          return batch;
        }),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      basicPriceImportRow: {
        create: jest.fn(),
        createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
          for (const row of data)
            (persisted[String(row.batchId)] ??= []).push(row);
          return { count: data.length };
        }),
        count: jest.fn(({ where }: { where: { batchId: string } }) =>
          Promise.resolve((persisted[where.batchId] ?? []).length),
        ),
        findMany: jest.fn(({ where }: { where: { batchId: string } }) =>
          Promise.resolve([...(persisted[where.batchId] ?? [])].reverse()),
        ),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      priceSubmission: { create: jest.fn(), update: jest.fn() },
      priceSubmissionRevision: { create: jest.fn() },
      priceSubmissionAudit: { create: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const prisma = {
      workspace: {
        findUnique: jest.fn(() =>
          Promise.resolve({ organizationId: ORGANIZATION_ID }),
        ),
      },
      basicPriceImportBatch: {
        findUnique: jest.fn(
          (args: {
            where: {
              workspaceId_importFingerprint?: { importFingerprint: string };
            };
          }) =>
            Promise.resolve(
              byFingerprint.get(
                String(
                  args.where.workspaceId_importFingerprint?.importFingerprint,
                ),
              ) ?? null,
            ),
        ),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(
          (args: {
            where?: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const matches = storedBatches.filter((batch) =>
              matchesWhere(batch, args.where),
            );
            if (!args.select) return Promise.resolve(matches);
            return Promise.resolve(
              matches.map((batch) =>
                Object.fromEntries(
                  Object.keys(args.select!).map((field) => [
                    field,
                    (batch as Record<string, unknown>)[field],
                  ]),
                ),
              ),
            );
          },
        ),
      },
      basicPriceImportRow: {
        findMany: jest.fn(({ where }: { where: { batchId: string } }) =>
          Promise.resolve(persisted[where.batchId] ?? []),
        ),
      },
      basicPrice: { findMany: jest.fn(() => Promise.resolve([])) },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceImportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PriceSubmissionReviewService,
          useValue: { createReviewWithinTransaction: jest.fn() },
        },
        {
          provide: BasicPriceSourceArchiveService,
          useValue: {
            retain: jest.fn(() => Promise.resolve('memory://retained')),
          },
        },
        {
          provide: BasicPriceRowResolutionProposalService,
          useValue: {
            proposeForRows: jest.fn(() => Promise.resolve(new Map())),
          },
        },
        // Proves nothing, so no column is eliminated and this suite tests
        // identity alone. The pruning law has its own suite.
        {
          provide: UnitKernelService,
          useValue: {
            resolveCanonicalUnitIdentities: jest.fn(() => Promise.resolve([])),
          },
        },
      ],
    }).compile();

    service = module.get<BasicPriceImportService>(BasicPriceImportService);
  });

  it('C-1: same source, same region, SAME interpretation — same fingerprint, and the replay finds its own batch', async () => {
    const first = await previewMatrix({});
    const fingerprint = fingerprintOf(0);

    const replay = await previewMatrix({});

    // ONE batch, entered once. The second call is a replay, not a rival.
    expect(created).toHaveLength(1);
    expect(replay.batchId).toBe(first.batchId);
    expect(replay.importFingerprint).toBe(fingerprint);
    expect(replay.reimport.classification).toBe('EXACT_EXISTING');
    expect(replay.reimport.existingBatchId).toBe(first.batchId);
  });

  it('C-2: same source, same region, DIFFERENT selectedUnitColumn — different fingerprint, new batch', async () => {
    const first = await previewMatrix({});
    const second = await previewMatrix({
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    });

    expect(created).toHaveLength(2);
    expect(fingerprintOf(0)).not.toBe(fingerprintOf(1));
    expect(interpretationOf(0).sourceUnitColumn).toBe(
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    );
    expect(interpretationOf(1).sourceUnitColumn).toBe(
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    );
    expect(second.reimport.classification).toBe('INTERPRETATION_UPDATE');
    expect(second.reimport.existingBatchId).toBe(first.batchId);
    expect(second.reimport.updateBatchId).toBe(second.batchId);
    expect(second.batchId).not.toBe(first.batchId);
  });

  it('R-3: repeating the exact interpretation update ten times creates one update batch', async () => {
    await previewMatrix({});
    const update = {
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    };
    const firstUpdate = await previewMatrix(update);
    const replays = [];
    for (let i = 0; i < 9; i += 1) {
      replays.push(await previewMatrix(update));
    }

    expect(created).toHaveLength(2);
    expect(
      replays.every((replay) => {
        const relation = replay.reimport as {
          classification: string;
        };
        return (
          replay.batchId === firstUpdate.batchId &&
          relation.classification === 'EXACT_EXISTING'
        );
      }),
    ).toBe(true);
  });

  it('C-3: same source, same region, DIFFERENT selectedNameColumn — different fingerprint, new batch', async () => {
    await previewMatrix({});
    await previewMatrix({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    });

    expect(created).toHaveLength(2);
    expect(fingerprintOf(0)).not.toBe(fingerprintOf(1));
    expect(interpretationOf(0).resourceNameColumn).toBe(
      UNKNOWN_UNIT_COLUMNS.NAME,
    );
    expect(interpretationOf(1).resourceNameColumn).toBe(
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    );
  });

  it('C-4: declaredSection CHANGES THE PARSE, so it changes identity — proved on the rows, not assumed', async () => {
    // The proof it belongs in identity at all. This source states no category of
    // its own, so the human's declaration IS every row's resource family — and
    // `sourceSection` is real downstream authority: the resolution service uses
    // it as the ResourceType context for Unit Kernel lookup and for
    // ResourceCatalog type matching.
    const asMaterial = await previewMatrix({ declaredSection: 'MATERIAL' });
    const asLabor = await previewMatrix({ declaredSection: 'LABOR' });

    expect(asMaterial.rows.every((row) => row.section === 'MATERIAL')).toBe(
      true,
    );
    expect(asLabor.rows.every((row) => row.section === 'LABOR')).toBe(true);
    expect(
      asMaterial.rows.every(
        (row) => row.sectionProvenance === 'UPLOADER_DECLARED',
      ),
    ).toBe(true);

    expect(created).toHaveLength(2);
    expect(fingerprintOf(0)).not.toBe(fingerprintOf(1));
    expect(interpretationOf(0).declaredSection).toBe('MATERIAL');
    expect(interpretationOf(1).declaredSection).toBe('LABOR');
  });

  it('C-5: A DIFFERENTLY-WORDED REQUEST FOR THE SAME READING IS THE SAME BATCH', async () => {
    /**
     * THE OTHER DIRECTION, AND THE REASON THIS RECORDS THE READING RATHER THAN
     * THE PARAMETERS. A sectioned workbook states its own column headers and its
     * own section titles, so it depends on no human answer whatsoever: the
     * column and section parameters below are ignored by the parse and MUST be
     * ignored by identity. Had the raw request been hashed instead, this stray
     * parameter would have minted a second batch for one unchanged truth —
     * duplicating the Owner's history to fix a duplication bug.
     */
    const honest = await service.preview(
      WORKSPACE_ID,
      ACCOUNT_ID,
      upload(sectionedBytes, 'BASIC PRICE.xlsx'),
      {},
    );
    const withNoise = await service.preview(
      WORKSPACE_ID,
      ACCOUNT_ID,
      upload(sectionedBytes, 'BASIC PRICE.xlsx'),
      {
        selectedNameColumn: 7,
        selectedUnitColumn: 9,
        declaredSection: 'EQUIPMENT',
      },
    );

    expect(created).toHaveLength(1);
    expect(withNoise.batchId).toBe(honest.batchId);
    expect(withNoise.importFingerprint).toBe(honest.importFingerprint);
  });

  it('C-6: a reading that depended on no human answer records NO interpretation — which is what keeps legacy fingerprints byte-identical', async () => {
    await service.preview(
      WORKSPACE_ID,
      ACCOUNT_ID,
      upload(sectionedBytes, 'BASIC PRICE.xlsx'),
      {},
    );

    // Null here is not "unknown". It is "the document decided all of this", and
    // it is the exact condition under which no segment joins the fingerprint.
    expect(interpretationOf(0)).toEqual({
      resourceNameColumn: null,
      sourceUnitColumn: null,
      declaredSection: null,
    });
  });

  it('C-7: the interpretation is AUDITABLE ON THE BATCH — a batch can be asked which reading produced it', async () => {
    await previewMatrix({});

    expect(interpretationOf(0)).toEqual({
      resourceNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
      sourceUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      declaredSection: 'MATERIAL',
    });
  });

  it('C-8: the fingerprint is stable across identical calls — the segment order is fixed, never the object order', async () => {
    // Two readings assembled independently must produce ONE string. A hash built
    // from however the fields happened to be enumerated would pass a single run
    // and fail intermittently forever after.
    const a = await previewMatrix({});
    const b = await previewMatrix({});
    const c = await previewMatrix({});
    expect(
      new Set([a.importFingerprint, b.importFingerprint, c.importFingerprint])
        .size,
    ).toBe(1);
    expect(created).toHaveLength(1);
  });
});

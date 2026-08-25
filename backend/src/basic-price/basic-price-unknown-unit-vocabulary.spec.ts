import { Test, TestingModule } from '@nestjs/testing';
import { BasicPriceImportService } from './basic-price-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { BasicPriceSourceArchiveService } from './basic-price-source-archive.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';
import { INTAKE_ERRORS } from '../universal-intake/intake-errors';
import { XlsxSourceReader } from '../universal-intake/readers/xlsx.reader';
import { detectTableStructures } from '../universal-intake/structure/structure-detector';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';
import {
  UNKNOWN_UNIT_COLUMNS,
  UNKNOWN_UNIT_KNOWN_VOCABULARY,
  UNKNOWN_UNIT_LOCAL_VOCABULARY,
  UNKNOWN_UNIT_REGIONS,
  UNKNOWN_UNIT_ROWS,
  buildUnknownUnitVocabularyXlsx,
} from '../../test/fixtures/unknown-unit-vocabulary.fixture';

/**
 * SIMPROK'S IGNORANCE MUST NEVER REMOVE A LAWFUL HUMAN CHOICE.
 *
 * A mirror once stood in `pruneDisprovenColumnCandidates` that took a column
 * off the UNIT options when the Unit Kernel resolved NOT ONE of the values it
 * stated. It reused the real authority and added no second dictionary, so it
 * looked disciplined. It was still invalid: ABSENCE OF PROOF IS NOT PROOF OF
 * ABSENCE. "I know none of these spellings" is a fact about how far SIMPROK's
 * dictionary reaches, and it says nothing whatever about what a document means.
 *
 * WHAT THAT COST A PERSON. A source whose unit column reads `sac` / `bundle` /
 * `roll` — a regional abbreviation, a foreign supplier, any vocabulary not yet
 * learned — had the ONE true answer deleted from its own question. SIMPROK's
 * gap became the user's dead end, which is the single thing this seam must
 * never do.
 *
 * WHAT STILL NARROWS THE QUESTION IS UNCHANGED AND PROVED ELSEWHERE: the
 * intake adapter refuses Name == Unit outright and removes the chosen name
 * column from the unit list unconditionally
 * (`basic-price-column-role-collision.spec.ts`). This suite asserts both halves
 * together, because a repair that restored the unknown column by also restoring
 * the named one would be no repair at all.
 */
/** The Unit authority's reply, kept to its real shape so nothing is softened. */
interface StubUnitAnswer {
  rawUnit: string;
  status: string;
  unitDefinition: { id: string; code: string; dimension: string } | null;
  matchedAliasIds: string[];
  contextScoped: boolean;
  appliedContext: null;
  reasonCodes: string[];
  explanation: string;
}

type UnitAnswerFn = (rawUnits: string[]) => Promise<StubUnitAnswer[]>;

/** The refusal body the intake boundary returns when it needs a human answer. */
interface ColumnQuestion {
  message?: string;
  nameCandidates?: { columnNumber: number }[];
  unitCandidates?: { columnNumber: number }[];
}

describe('UNKNOWN UNIT VOCABULARY — a column SIMPROK cannot read is still a column a person can read', () => {
  let service: BasicPriceImportService;
  let units: {
    resolveCanonicalUnitIdentities: jest.Mock<
      Promise<StubUnitAnswer[]>,
      [string[]]
    >;
  };

  const WORKSPACE_ID = 'ws-01';
  const ORGANIZATION_ID = 'org-01';
  const ACCOUNT_ID = 'account-01';
  const FILE = 'kosakata-satuan-uji.xlsx';

  let bytes: Buffer;

  /** Exactly the vocabulary the stub answers RESOLVED for, and nothing else. */
  const KNOWN = new Set<string>(UNKNOWN_UNIT_KNOWN_VOCABULARY);

  const columnNumbers = (
    candidates: { columnNumber: number }[] | undefined,
  ): number[] => (candidates ?? []).map((candidate) => candidate.columnNumber);

  const preview = (selection: Partial<PreviewBasicPriceImportDto>) =>
    service.preview(
      WORKSPACE_ID,
      ACCOUNT_ID,
      { buffer: bytes, size: bytes.length, originalname: FILE },
      {
        declaredSection: 'MATERIAL',
        selectedRegionLabel: UNKNOWN_UNIT_REGIONS[0],
        ...selection,
      },
    );

  /** The refusal itself, so the OFFERED OPTIONS can be asserted. */
  const refusalOf = async (
    selection: Partial<PreviewBasicPriceImportDto>,
  ): Promise<ColumnQuestion> => {
    try {
      await preview(selection);
    } catch (error) {
      return (error as { response?: ColumnQuestion }).response ?? {};
    }
    throw new Error('expected a refusal; the preview was accepted');
  };

  beforeAll(async () => {
    bytes = await buildUnknownUnitVocabularyXlsx();
  }, 60_000);

  beforeEach(async () => {
    // `createMany` answers with a count, exactly as Prisma does, so the rows it
    // was given are what the read-back returns — and it returns them REVERSED.
    // Prisma guarantees no order on an unsorted findMany and the service must
    // reassemble source order from the ids it minted itself; a mock that handed
    // back insertion order would let an order bug pass here.
    const persisted: Record<string, Record<string, unknown>[]> = {};
    const tx = {
      basicPriceImportBatch: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
          id: 'batch-1',
          version: 0,
          ...data,
        })),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      basicPriceImportRow: {
        create: jest.fn(),
        createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
          for (const row of data) {
            const batchId = String(row.batchId);
            (persisted[batchId] ??= []).push(row);
          }
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
        findUnique: jest.fn(() => Promise.resolve(null)),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      basicPriceImportRow: { findMany: jest.fn(() => Promise.resolve([])) },
      basicPrice: { findMany: jest.fn(() => Promise.resolve([])) },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };

    // THE REAL AUTHORITY'S CONTRACT, STUBBED WITHOUT SOFTENING IT. Every
    // spelling is echoed verbatim, RESOLVED only for vocabulary this stub
    // genuinely holds, and NEEDS_REVIEW — never an error — for everything else.
    // That is exactly what UnitKernelService answers for an unknown alias, and
    // it is the answer the deleted mirror mistook for a verdict.
    units = {
      resolveCanonicalUnitIdentities: jest.fn((rawUnits: string[]) =>
        Promise.resolve(
          rawUnits.map((rawUnit) => ({
            rawUnit,
            status: KNOWN.has(rawUnit)
              ? UNIT_RESOLUTION_STATUS.RESOLVED
              : UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
            unitDefinition: KNOWN.has(rawUnit)
              ? { id: `unit-${rawUnit}`, code: rawUnit, dimension: 'TEST' }
              : null,
            matchedAliasIds: [],
            contextScoped: false,
            appliedContext: null,
            reasonCodes: [],
            explanation: 'stubbed',
          })),
        ),
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
        { provide: UnitKernelService, useValue: units },
      ],
    }).compile();

    service = module.get<BasicPriceImportService>(BasicPriceImportService);
  });

  it('B-0: the surface is real — three untitled text columns all reach the unit question', async () => {
    // A guard on the fixture. If this shape ever stopped asking the column
    // question, or stopped offering all three columns, every assertion below
    // would be proving nothing.
    const details = await refusalOf({});

    expect(details.message).toBe(INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED);
    for (const column of [
      UNKNOWN_UNIT_COLUMNS.NAME,
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    ])
      expect(columnNumbers(details.unitCandidates)).toContain(column);
  });

  it('B-0b: the Unit authority genuinely knows none of the local vocabulary', async () => {
    // Without this, B-1 could pass because the stub quietly recognised `sac`.
    const answers = await units.resolveCanonicalUnitIdentities([
      ...UNKNOWN_UNIT_LOCAL_VOCABULARY,
    ]);
    expect(
      answers.every(
        (answer) => answer.status === UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
      ),
    ).toBe(true);
  });

  it('B-1: THE UNKNOWN-BUT-REAL UNIT COLUMN REMAINS SELECTABLE, beside a known one', async () => {
    const details = await refusalOf({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
    });

    // THE REPAIR. Not one value in this column is a unit SIMPROK knows, and it
    // is still on the list — because the document, not the dictionary, decides
    // what the column holds.
    expect(columnNumbers(details.unitCandidates)).toContain(
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    );

    // THE COLUMN THAT DEFEATS THE FAIL-OPEN ALIBI. The old mirror left this one
    // standing, so the filtered list was never empty and never restored — which
    // is precisely why the unknown column above disappeared for real.
    expect(columnNumbers(details.unitCandidates)).toContain(
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    );

    // AND THE OTHER HALF OF THE LAW, IN THE SAME BREATH. The column just named
    // as the resource name is gone: a repair that restored the unknown option
    // by restoring the impossible one would be no repair.
    expect(columnNumbers(details.unitCandidates)).not.toContain(
      UNKNOWN_UNIT_COLUMNS.NAME,
    );
  });

  it('B-1b: the authority WAS consulted — the column survives a real answer, not a skipped question', async () => {
    // The mirror could also have been "fixed" by never asking. That would keep
    // this column and silently break the name-side elimination, so the call
    // itself is asserted.
    await refusalOf({ selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME });
    expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalled();
  });

  it('B-1c: NO ANSWER THE AUTHORITY COULD GIVE SHORTENS THE UNIT LIST — including total silence', async () => {
    // The invariant stated as a property rather than a case. Whatever the
    // Kernel says, the unit options are exactly what the document offered.
    const offered = columnNumbers((await refusalOf({})).unitCandidates);

    const answers: UnitAnswerFn[] = [
      () => Promise.resolve([]),
      (raw) =>
        Promise.resolve(
          raw.map((rawUnit) => ({
            rawUnit,
            status: UNIT_RESOLUTION_STATUS.RESOLVED,
            unitDefinition: { id: 'u', code: rawUnit, dimension: 'TEST' },
            matchedAliasIds: [],
            contextScoped: false,
            appliedContext: null,
            reasonCodes: [],
            explanation: 'everything is a unit',
          })),
        ),
      (raw) =>
        Promise.resolve(
          raw.map((rawUnit) => ({
            rawUnit,
            status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
            unitDefinition: null,
            matchedAliasIds: [],
            contextScoped: false,
            appliedContext: null,
            reasonCodes: [],
            explanation: 'nothing is a unit',
          })),
        ),
    ];

    for (const answer of answers) {
      units.resolveCanonicalUnitIdentities.mockImplementation(answer);
      expect(columnNumbers((await refusalOf({})).unitCandidates)).toEqual(
        offered,
      );
    }
  });

  it('B-1d: THE WITNESS — the deleted inference, applied to this very document, deletes the true answer', async () => {
    /**
     * WHY A TEST RESTATES LOGIC THAT NO LONGER EXISTS. Without this, B-1 could
     * be passing for a reason that has nothing to do with the repair — a
     * fixture whose columns never reached the mirror would satisfy it just as
     * well, and the suite would guard nothing. So the removed inference is
     * applied here, locally, to the SAME candidates the real detector produces.
     * It must reach the wrong answer. That is what makes B-1 discriminating.
     *
     * Nothing below is imported from the service. It is a historical record of
     * a defect, kept next to the proof that the defect is gone.
     */
    const read = await new XlsxSourceReader().read(testEnvelope(bytes, FILE));
    const detected = detectTableStructures(read.tables[0]).candidates[0];
    const offered = detected.columnRoles.unitCandidates.filter(
      (candidate) => candidate.columnNumber !== UNKNOWN_UNIT_COLUMNS.NAME,
    );
    expect(columnNumbers(offered)).toEqual([
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    ]);

    // "NOT ONE of its values is a unit I know, therefore it is not a unit
    // column." The invalid step, verbatim in its effect.
    const survivesTheOldMirror = offered.filter((candidate) =>
      candidate.proofValues.some((value) => KNOWN.has(value)),
    );

    expect(columnNumbers(survivesTheOldMirror)).toEqual([
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    ]);
    // The real unit column is gone, and the list it left behind is NOT empty —
    // so the fail-open that would have rescued it never fires. This document
    // states the defect exactly.
    expect(columnNumbers(survivesTheOldMirror)).not.toContain(
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    );
    expect(survivesTheOldMirror.length).toBeGreaterThan(0);
  });

  it('B-2: the name direction still eliminates — the known-unit column leaves the NAME options', async () => {
    // NON-REGRESSION, and the reason the asymmetry is deliberate rather than a
    // retreat. Proving a column IS units still takes it off the name list;
    // failing to prove it says nothing in either direction.
    const details = await refusalOf({});

    expect(columnNumbers(details.nameCandidates)).not.toContain(
      UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT,
    );
    expect(columnNumbers(details.nameCandidates)).toContain(
      UNKNOWN_UNIT_COLUMNS.NAME,
    );
    // And the unknown column stays a possible NAME too. SIMPROK cannot disprove
    // it in that direction either, and guessing is not its job.
    expect(columnNumbers(details.nameCandidates)).toContain(
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    );
  });

  it('B-3: naming ONE column for both roles is still refused', async () => {
    const details = await refusalOf({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    });
    expect(details.message).toBe(INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED);
    expect(columnNumbers(details.unitCandidates)).not.toContain(
      UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    );
  });

  it('B-4: THE PAYOFF — the unreadable unit column is ACCEPTED, and each row keeps the document own wording', async () => {
    const result = await preview({
      selectedNameColumn: UNKNOWN_UNIT_COLUMNS.NAME,
      selectedUnitColumn: UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT,
    });

    expect(result.totalRows).toBe(UNKNOWN_UNIT_ROWS.length);

    // SIMPROK STORES WHAT IT CANNOT YET UNDERSTAND, TRUTHFULLY. The raw unit is
    // the source's own word, unchanged and untranslated, and every row waits for
    // review rather than being resolved or discarded. Learning the alias later
    // is a canonical-knowledge job for a curator — never a reason to refuse the
    // import now, and never a reason to invent a unit the source never stated.
    expect(result.rows.map((row) => row.unit)).toEqual(
      UNKNOWN_UNIT_ROWS.map((row) => row.localUnit),
    );
    expect(result.rows.map((row) => row.name)).toEqual(
      UNKNOWN_UNIT_ROWS.map((row) => row.name),
    );
    // No row wears its own name as its unit — the shape of the Owner's 934-row
    // defect, asserted away on a document SIMPROK cannot fully read.
    for (const row of result.rows) expect(row.unit).not.toBe(row.name);
    // And every row waits for a human. An unreadable unit is a review item,
    // never a silent resolution and never a discarded row.
    expect(
      result.rows.every(
        (row) =>
          row.status === 'NEEDS_REVIEW' &&
          row.resolutionStatus === 'UNRESOLVED',
      ),
    ).toBe(true);
  });

  it('B-5: proof evidence never reaches the browser, in either list', async () => {
    // `proofValues` is every distinct value a column states. It exists so a
    // proof can reason over evidence, not so a screen can receive it.
    const details = await refusalOf({});
    for (const candidate of [
      ...(details.nameCandidates ?? []),
      ...(details.unitCandidates ?? []),
    ])
      expect(candidate).not.toHaveProperty('proofValues');
  });
});

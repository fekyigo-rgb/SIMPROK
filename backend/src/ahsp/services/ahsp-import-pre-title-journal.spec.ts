import { ImportStatus } from '@prisma/client';
import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import {
  AHSP_DOCUMENT_CONTRACT_VERSION,
  AHSP_DOCUMENT_REASON,
  AhspDocumentKnowledge,
} from '../document/ahsp-document-knowledge';
import {
  understandAhspDocument,
  withTitleOutputUnitStatement,
} from '../document/ahsp-document-understanding';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import { sealSourceEnvelope } from '../../universal-intake/source-envelope';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';
import {
  inMemoryImportJournal,
  transactionalPrisma,
} from '../../../test/fixtures/ahsp-import-journal.fixture';
import { PRE_TITLE_READER_KNOWLEDGE as PRE_TITLE } from '../../../test/fixtures/ahsp-pre-title-journal-knowledge.fixture';

/**
 * CLOSEOUT P1-B — JOURNAL LINES KEPT BEFORE WORK TITLES WERE READ.
 *
 * The knowledge contract was not bumped when the reader learned to read the output
 * unit a work title states, so lines kept by the earlier reader are continued under
 * the same contract. These lines are NOT guessed: PRE_TITLE_READER_KNOWLEDGE is what
 * the pre-title reader itself produced (see the fixture's provenance). Each case is
 * asked the two questions that matter — what the list says, and what "Periksa ulang"
 * does — without the file, and without rewriting anything that was kept.
 */

type Dependencies = ConstructorParameters<
  typeof AhspDocumentCanonicalizationService
>;
type StoredVersion = {
  id: string;
  versionNumber: number;
  outputUnit: string;
  ahsp: { id: string };
  resources: Array<{
    id: string;
    resourceId: string;
    resourceType: string;
    coefficient: number;
    baseUnit: string;
    rawName: string | null;
    rawCode: string | null;
    rawUnit: string | null;
  }>;
};
type VersionScope = { id?: { in: string[] }; ahspId?: { in: string[] } };

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const knowing = (definitions: Record<string, string>) => (raw: string) =>
  Promise.resolve(
    definitions[raw] !== undefined
      ? {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: definitions[raw] },
        }
      : { status: 'NEEDS_REVIEW', sourceUnitDefinition: null },
  );
const EVERY_UNIT = {
  m3: 'unit-m3',
  'm³': 'unit-m3',
  M2: 'unit-m2',
  OH: 'unit-oh',
};

describe('CLOSEOUT P1-B — the fixture is what the pre-title reader kept', () => {
  it('same contract; no title statement; the title it would be read from was kept', () => {
    for (const document of Object.values(PRE_TITLE)) {
      expect(document.contractVersion).toBe(AHSP_DOCUMENT_CONTRACT_VERSION);
      const [item] = document.workItems;
      expect(item).not.toHaveProperty('outputUnitStatements');
      expect(item.methodName).toMatchObject({ locator: 'C5' });
    }
    const a = PRE_TITLE.LEGACY_A_TITLE_ONLY.workItems[0];
    expect(a.reasonCodes).toEqual([AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT]);
    expect(a.outputUnitRaw).toBeNull();
    const b = PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3.workItems[0];
    expect(b.reasonCodes).toEqual([]);
    expect(b.outputUnitRaw).toMatchObject({ raw: 'm3', locator: 'B21' });
    const c = PRE_TITLE.LEGACY_C_CONTRADICTION_NOT_KEPT.workItems[0];
    expect(c.reasonCodes).toEqual([AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY]);
    expect(c.outputUnitRaw).toBeNull();
  });
});

describe('CLOSEOUT P1-B — withTitleOutputUnitStatement, the minimum read-only adapter', () => {
  it('LEGACY-A: adds only the statement the title makes, located at the title cell — the unit is no longer missing', () => {
    const item = PRE_TITLE.LEGACY_A_TITLE_ONLY.workItems[0];
    const kept = JSON.stringify(item);
    const adapted = withTitleOutputUnitStatement(item);
    expect(adapted.reasonCodes).toEqual([]);
    expect(adapted.status).toBe('READY');
    expect(adapted.outputUnitRaw).toEqual({ ...item.methodName, raw: 'M2' });
    expect(adapted).not.toHaveProperty('outputUnitStatements');
    expect(JSON.stringify(item)).toBe(kept);
  });

  it('LEGACY-B: a title that states another spelling than the kept summary — both kept, none picked, held for the Unit Kernel to weigh', () => {
    const item = PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3.workItems[0];
    const adapted = withTitleOutputUnitStatement(item);
    expect(adapted.outputUnitRaw).toBeNull();
    expect(
      adapted.outputUnitStatements?.map((statement) => [
        statement.raw,
        statement.locator,
      ]),
    ).toEqual([
      ['m3', 'B21'],
      ['M2', 'C5'],
    ]);
    expect(adapted.reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    ]);
    expect(adapted.status).toBe('UNRESOLVED');
  });

  it('LEGACY-C: a contradiction recorded WITHOUT its statements is returned exactly as kept — nothing is invented', () => {
    const item = PRE_TITLE.LEGACY_C_CONTRADICTION_NOT_KEPT.workItems[0];
    expect(withTitleOutputUnitStatement(item)).toBe(item);
  });

  it('knowledge the current reader produced is returned as it is', async () => {
    const read = async (title: string, summary: string) => {
      const envelope = sealSourceEnvelope({
        ingestionChannel: 'USER_UPLOAD',
        fileName: 'current.xlsx',
        mediaType: null,
        bytes: await buildAhspAnalisaXlsx((sheet) => {
          sheet.getCell('C5').value = title;
          sheet.getCell('B21').value = summary;
        }),
        workspaceId: WORKSPACE,
        organizationId: '22222222-2222-4222-8222-222222222222',
        actorAccountId: '33333333-3333-4333-8333-333333333333',
      });
      const document = understandAhspDocument(
        await ReaderRegistry.default().read(envelope),
        envelope,
      );
      return document.workItems[0];
    };
    for (const item of [
      await read(
        'PEMASANGAN 1 M2 PLESTERAN DINDING',
        'HARGA SATUAN PEKERJAAN (D + E)',
      ),
      await read(
        'PEMASANGAN 1 M2 PLESTERAN DINDING',
        'Harga Satuan Pekerjaan per - M2 (D+E)',
      ),
      await read(
        'PEMASANGAN 1 M2 PLESTERAN DINDING',
        'Harga Satuan Pekerjaan per - m3 (D+E)',
      ),
      await read('Plesteran dinding', 'Harga Satuan Pekerjaan per - m2 (D+E)'),
    ]) {
      expect(withTitleOutputUnitStatement(item)).toBe(item);
    }
  });
});

describe('CLOSEOUT P1-B — the list and "Periksa ulang" over pre-title lines, without the file', () => {
  const ahspService = {
    create: jest.fn(),
    loadIdentitySurface: jest.fn(() => Promise.resolve([])),
  };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = { loadEvidence: jest.fn(), resolve: jest.fn() };
  const observations = {
    observeMany: jest.fn(),
    // F1 — the import reader asks which rows a person already decided.
    // No decisions is the truthful default for a fixture that has none.
    decidedIdentityForSourceRows: jest.fn().mockResolvedValue(new Map()),

    openQuestionsBySource: jest.fn(() => Promise.resolve(new Map())),
  };
  let versions: Map<string, StoredVersion>;
  const aHSPVersion = {
    findMany: jest.fn(
      ({ where }: { where: { AND: [VersionScope, unknown] } }) => {
        const [scope] = where.AND;
        return Promise.resolve(
          [...versions.values()].filter((version) =>
            scope.id
              ? scope.id.in.includes(version.id)
              : (scope.ahspId?.in ?? []).includes(version.ahsp.id),
          ),
        );
      },
    ),
  };
  const { prisma } = transactionalPrisma({
    resourceSourceIdentity: { createMany: jest.fn(() => Promise.resolve()) },
    aHSPVersion,
  });
  let journal: ReturnType<typeof inMemoryImportJournal>;
  let service: AhspDocumentCanonicalizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    versions = new Map();
    units.resolve.mockImplementation(knowing(EVERY_UNIT));
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [{ id: 'catalog-known' }],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      resolvedResourceCatalogId: 'catalog-known',
    });
    ahspService.create.mockResolvedValue({ id: 'ahsp-new' });
    versionService.createVersion.mockImplementation(
      (
        ahspId: string,
        dto: {
          outputUnit: string;
          resources: Array<Omit<StoredVersion['resources'][number], 'id'>>;
        },
      ) => {
        const id = `ver-${versions.size + 1}`;
        versions.set(id, {
          id,
          versionNumber: 1,
          outputUnit: dto.outputUnit,
          ahsp: { id: ahspId },
          resources: dto.resources.map((resource, index) => ({
            ...resource,
            id: `${id}-resource-${index + 1}`,
          })),
        });
        return Promise.resolve({ id });
      },
    );
    observations.observeMany.mockResolvedValue({ persisted: 0 });
    journal = inMemoryImportJournal();
    service = new AhspDocumentCanonicalizationService(
      ...([
        ahspService,
        versionService,
        units,
        identity,
        prisma,
        observations,
        new RealityNormalizationEngine(),
        { logAction: jest.fn(() => Promise.resolve()) },
        journal,
        // C1 — the commit retains the source bytes before journalling them.
        { retain: jest.fn().mockResolvedValue("ws/digest/source") },
      ] as unknown as Dependencies),
    );
  });

  /** A job exactly as the pre-title journal kept it: the document, then how that evaluation settled its line. */
  const keptJob = async (
    document: AhspDocumentKnowledge,
    settled:
      | { status: 'PENDING'; reasonCodes: string[] }
      | { status: 'COMPLETED'; outputUnit: string },
  ) => {
    const { importJobId, lines } = await journal.recordDocument({
      workspaceId: WORKSPACE,
      userId: 'user-pre-title',
      knowledge: document,
    });
    const [line] = lines;
    if (settled.status === 'PENDING') {
      await journal.settleLine(prisma, {
        workspaceId: WORKSPACE,
        lineId: line.id,
        status: ImportStatus.PENDING,
        reasonCodes: settled.reasonCodes,
      });
    } else {
      // The pre-title writer's recipe: every component proved, the one output unit it read.
      const item = document.workItems[0];
      const { id: versionId } = (await versionService.createVersion(
        'ahsp-pre-title',
        {
          outputUnit: settled.outputUnit,
          resources: item.resources.map((resource) => ({
            resourceId: 'catalog-known',
            resourceType: resource.group ?? 'LABOR',
            coefficient: resource.coefficient ?? 0,
            baseUnit: resource.rawUnit ?? '',
            rawName: resource.rawName,
            rawCode: resource.rawCode,
            rawUnit: resource.rawUnit,
          })),
        },
      )) as { id: string };
      await journal.settleLine(prisma, {
        workspaceId: WORKSPACE,
        lineId: line.id,
        status: ImportStatus.COMPLETED,
        reasonCodes: item.reasonCodes,
        ahspId: 'ahsp-pre-title',
        ahspVersionId: versionId,
      });
    }
    jest.clearAllMocks();
    return importJobId;
  };
  const listed = async (importJobId: string) => {
    const job = (await service.listImportJobs(WORKSPACE)).items.find(
      (candidate) => candidate.importJobId === importJobId,
    );
    if (!job) throw new Error('job not listed');
    return job;
  };
  const continued = (importJobId: string) =>
    service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId,
      userId: 'user-now',
    });
  const readsTheFile = () => jest.spyOn(ReaderRegistry.prototype, 'read');
  const keptKnowledge = (importJobId: string) =>
    JSON.stringify(journal.linesOf(importJobId).map((line) => line.knowledge));

  it('LEGACY-A PENDING: the list says the reading was updated, and "Periksa ulang" writes the unit the kept title states — without the file', async () => {
    const importJobId = await keptJob(PRE_TITLE.LEGACY_A_TITLE_ONLY, {
      status: 'PENDING',
      reasonCodes: [AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT],
    });
    const kept = keptKnowledge(importJobId);
    const job = await listed(importJobId);
    expect(job.waiting).toEqual([
      expect.objectContaining({ lineNumber: 1, readingUpdated: true }),
    ]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(journal.settleLine).not.toHaveBeenCalled();

    const read = readsTheFile();
    const result = await continued(importJobId);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(result.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    expect(versions.get(result.written[0].versionId)?.outputUnit).toBe('M2');
    expect(journal.linesOf(importJobId)[0].status).toBe('COMPLETED');
    // What was kept is still exactly what the pre-title reader kept.
    expect(keptKnowledge(importJobId)).toBe(kept);
  });

  it('LEGACY-B PENDING: an old hold no longer hides the title/summary contradiction — "Periksa ulang" holds it as a source conflict and writes nothing', async () => {
    const importJobId = await keptJob(PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3, {
      status: 'PENDING',
      reasonCodes: [AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED],
    });
    const kept = keptKnowledge(importJobId);
    expect((await listed(importJobId)).waiting).toEqual([
      expect.objectContaining({ readingUpdated: true, unitsKnownNow: true }),
    ]);
    const result = await continued(importJobId);
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    ]);
    const [line] = journal.linesOf(importJobId);
    expect(line.status).toBe('PENDING');
    expect((await listed(importJobId)).waiting).toEqual([
      expect.objectContaining({ statedOutputUnits: ['m3', 'M2'] }),
    ]);
    expect(keptKnowledge(importJobId)).toBe(kept);
  });

  it('LEGACY-B COMPLETED: a recipe the pre-title writer saved with "m3" under a title stating "1 M2" is a written unit question, never complete — and nothing is rewritten', async () => {
    const importJobId = await keptJob(PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3, {
      status: 'COMPLETED',
      outputUnit: 'm3',
    });
    const job = await listed(importJobId);
    expect(job.completion).toEqual({
      complete: 0,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
      writtenUnitQuestions: [
        {
          lineNumber: 1,
          workType: '1.7.7.1.1.b (a)',
          methodName: 'PEMASANGAN 1 M2 PLESTERAN DINDING',
          statedOutputUnits: ['m3', 'M2'],
          provenDifferent: true,
        },
      ],
      identityQuestions: { questions: 0, uses: 0 },
    });
    expect(job.counts).toMatchObject({ represented: 1, waiting: 0 });

    // "Periksa ulang" never reopens a saved line, and the saved recipe keeps its history.
    const result = await continued(importJobId);
    expect(result.written).toEqual([]);
    expect(versionService.createVersion).not.toHaveBeenCalled();
    expect(journal.settleLine).not.toHaveBeenCalled();
    expect([...versions.values()].map((version) => version.outputUnit)).toEqual(
      ['m3'],
    );
  });

  it('LEGACY-B COMPLETED with a spelling the Unit Kernel does not know: still a written unit question, but never called proven different', async () => {
    units.resolve.mockImplementation(knowing({ m3: 'unit-m3', OH: 'unit-oh' }));
    const importJobId = await keptJob(PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3, {
      status: 'COMPLETED',
      outputUnit: 'm3',
    });
    const { completion } = await listed(importJobId);
    expect(completion.complete).toBe(0);
    expect(completion.writtenUnitQuestions).toEqual([
      expect.objectContaining({
        statedOutputUnits: ['m3', 'M2'],
        provenDifferent: false,
      }),
    ]);
  });

  it('POSITIVE CONTROL COMPLETED: "1 m³" over "per - m3" is one unit to the Unit Kernel — complete, no false conflict', async () => {
    const importJobId = await keptJob(
      PRE_TITLE.POSITIVE_TITLE_M3_SUPERSCRIPT_SUMMARY_M3,
      { status: 'COMPLETED', outputUnit: 'm3' },
    );
    expect((await listed(importJobId)).completion).toEqual({
      complete: 1,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
  });

  it('POSITIVE CONTROL PENDING: "Periksa ulang" writes the one unit both statements name', async () => {
    const importJobId = await keptJob(
      PRE_TITLE.POSITIVE_TITLE_M3_SUPERSCRIPT_SUMMARY_M3,
      {
        status: 'PENDING',
        reasonCodes: [AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED],
      },
    );
    const result = await continued(importJobId);
    expect(result.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    expect(versions.get(result.written[0].versionId)?.outputUnit).toBe('m3');
  });

  it('LEGACY-C PENDING: a contradiction kept without its statements stays exactly as it was — not rebuildable without the file', async () => {
    const importJobId = await keptJob(
      PRE_TITLE.LEGACY_C_CONTRADICTION_NOT_KEPT,
      {
        status: 'PENDING',
        reasonCodes: [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
      },
    );
    const job = await listed(importJobId);
    expect(job.waiting[0]).not.toHaveProperty('readingUpdated');
    const result = await continued(importJobId);
    expect(result.written).toEqual([]);
    expect(result.skipped[0].reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY,
    ]);
  });
});

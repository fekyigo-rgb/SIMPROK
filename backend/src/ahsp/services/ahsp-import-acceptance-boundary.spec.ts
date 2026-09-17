import { ConflictException } from '@nestjs/common';
import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import {
  AHSP_DOCUMENT_CONTRACT_VERSION,
  AHSP_DOCUMENT_REASON,
} from '../document/ahsp-document-knowledge';
import { identicalQuestionKey } from '../../resource-catalog/identical-question-key';
import { E1A_RESOLUTION_POLICY_VERSION } from '../../project-ahsp/ahsp-resource-resolution.orchestrator';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import type { AhspDocumentEnvelope } from './ahsp-import.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';
import {
  inMemoryImportJournal,
  transactionalPrisma,
} from '../../../test/fixtures/ahsp-import-journal.fixture';

type CanonicalizationDependencies = ConstructorParameters<
  typeof AhspDocumentCanonicalizationService
>;
type SheetMutation = NonNullable<Parameters<typeof buildAhspAnalisaXlsx>[0]>;
type WrittenResource = { resourceId: string };
/** A version as the eligibility query reads it back: the columns the completion view selects. */
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

/** One argument of one recorded call, in the shape the service passed it. */
const callArgument = <T>(mock: jest.Mock, call: number, index: number): T =>
  (mock.mock.calls as T[][])[call][index];

/**
 * AHSP IMPORT ACCEPTANCE BOUNDARY — the seams, proven against the anchors.
 *
 * Every test named B0-n replaces an anchor that pinned a failure shape the
 * forensic audit proved at dc6e503; its note says what the anchor asserted, so the
 * diff shows exactly which truth moved and why.
 */

const RESOLVED_UNIT = {
  status: UNIT_RESOLUTION_STATUS.RESOLVED,
  sourceUnitDefinition: { id: 'unit-1' },
};
const UNPROVEN_UNIT = { status: 'NEEDS_REVIEW', sourceUnitDefinition: null };

/** Two analyses: the fixture's own item, and a second whose only component is "Tukang Gali". */
const twoItemWorkbook = () =>
  buildAhspAnalisaXlsx((sheet) => {
    sheet.getCell('A23').value = 'B.98';
    sheet.getCell('C23').value = 'Pekerjaan kedua contoh';
    sheet.getCell('A24').value = 'No.';
    sheet.getCell('B24').value = 'Uraian';
    sheet.getCell('E24').value = 'Kode';
    sheet.getCell('F24').value = 'Satuan';
    sheet.getCell('G24').value = 'Koefisien';
    sheet.getCell('B27').value = 'Tenaga Kerja';
    sheet.getCell('B28').value = 'Tukang Gali';
    sheet.getCell('E28').value = 'L.02';
    sheet.getCell('F28').value = 'OH';
    sheet.getCell('G28').value = 0.3;
    sheet.getCell('B31').value = 'Harga Satuan Pekerjaan per - m3 (D+E)';
  });

describe('AHSP import acceptance boundary — seams', () => {
  const ahspService = { create: jest.fn(), loadIdentitySurface: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = { loadEvidence: jest.fn(), resolve: jest.fn() };
  const sightings = { createMany: jest.fn() };
  /**
   * The versions the writer created, read back by the completion view. Every one
   * is lawful here; the eligibility law itself is proven against the database in
   * the acceptance e2e.
   */
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
  const storeVersion = (
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
        id: `${id}-resource-${index + 1}`,
        resourceId: resource.resourceId,
        resourceType: resource.resourceType,
        coefficient: resource.coefficient,
        baseUnit: resource.baseUnit,
        rawName: resource.rawName,
        rawCode: resource.rawCode,
        rawUnit: resource.rawUnit,
      })),
    });
    return Promise.resolve({ id });
  };
  const { prisma, tx } = transactionalPrisma({
    resourceSourceIdentity: sightings,
    aHSPVersion,
  });
  const observations = {
    observeMany: jest.fn(),
    openQuestionsBySource: jest.fn(),
  };
  const audit = { logAction: jest.fn() };
  let journal: ReturnType<typeof inMemoryImportJournal>;
  let service: AhspDocumentCanonicalizationService;

  const proven = {
    status: 'RESOLVED',
    resolvedResourceCatalogId: 'catalog-known',
  };
  const unknown = {
    status: 'UNRESOLVED',
    resolvedResourceCatalogId: null,
    candidates: [],
  };

  /** The service over these doubles, journaling into the given in-memory journal. */
  const build = (withJournal: ReturnType<typeof inMemoryImportJournal>) =>
    new AhspDocumentCanonicalizationService(
      ...([
        ahspService,
        versionService,
        units,
        identity,
        prisma,
        observations,
        new RealityNormalizationEngine(),
        audit,
        withJournal,
      ] as unknown as CanonicalizationDependencies),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    units.resolve.mockResolvedValue(RESOLVED_UNIT);
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue(proven);
    ahspService.create.mockResolvedValue({ id: 'ahsp-1' });
    ahspService.loadIdentitySurface.mockResolvedValue([]);
    versions = new Map();
    versionService.createVersion.mockImplementation(storeVersion);
    observations.observeMany.mockResolvedValue({ persisted: 1 });
    observations.openQuestionsBySource.mockResolvedValue(new Map());
    audit.logAction.mockResolvedValue(undefined);
    sightings.createMany.mockResolvedValue(undefined);
    journal = inMemoryImportJournal();
    service = build(journal);
  });

  const envelopeFrom = (bytes: Buffer) =>
    service.sealUpload({
      bytes,
      fileName: 'boundary.xlsx',
      mediaType: null,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      actorAccountId: '33333333-3333-4333-8333-333333333333',
    });

  const onlyByName =
    (names: readonly string[]) =>
    (_evidence: unknown, reference: { rawName: string }) =>
      Promise.resolve(names.includes(reference.rawName) ? unknown : proven);

  // ── IMPORT-SEAM-09 — one line, one authoritative outcome ──

  it('F01: the same document committed again acts on nothing — the line already settled keeps its result', async () => {
    const bytes = await buildAhspAnalisaXlsx();
    const envelope = envelopeFrom(bytes);
    const first = await service.commit(envelope, 'user-1');
    expect(first.summary).toMatchObject({ evaluated: 1, ready: 1, alreadyProcessed: 0 });
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    const settled = [...journal.lines.values()].map((line) => ({
      status: line.status,
      ahspId: line.ahspId,
      ahspVersionId: line.ahspVersionId,
    }));

    // THE REPLAY — same bytes, and this time a decision that would create a second
    // AHSP if the line were still open. Nothing is written, and the answer says so.
    const replay = await service.commit(envelope, 'user-1', [
      {
        workType: first.written[0].workType,
        methodName: first.written[0].methodName,
        action: 'KEEP_SEPARATE',
      },
    ]);
    expect(replay.summary).toMatchObject({
      evaluated: 1,
      ready: 0,
      alreadyPresent: 0,
      alreadyProcessed: 1,
      held: 0,
      failed: 0,
    });
    expect(replay.written).toEqual([]);
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
    // The journal is exactly as the first evaluation left it.
    expect(
      [...journal.lines.values()].map((line) => ({
        status: line.status,
        ahspId: line.ahspId,
        ahspVersionId: line.ahspVersionId,
      })),
    ).toEqual(settled);
    // And the settlement was decided under the line's lock, not from a stale read.
    expect(journal.lockLine).toHaveBeenCalled();
  });

  // ── IMPORT-SEAM-03 — source truth is captured before, and never behind, the writes ──

  it('B0-2 (flipped): unresolved resource facts are observed BEFORE any canonical write', async () => {
    // Anchor asserted: create ran before observeMany.
    identity.resolve.mockImplementation(onlyByName(['Tukang Gali']));
    await service.commit(envelopeFrom(await twoItemWorkbook()), 'user-1');
    expect(observations.observeMany).toHaveBeenCalledTimes(1);
    expect(observations.observeMany.mock.invocationCallOrder[0]).toBeLessThan(
      ahspService.create.mock.invocationCallOrder[0],
    );
  });

  it('IMPORT-SEAM-03: if the observation cannot be kept, no canonical write begins', async () => {
    identity.resolve.mockImplementation(onlyByName(['Tukang Gali']));
    observations.observeMany.mockRejectedValue(
      new Error('observation store unavailable'),
    );
    await expect(
      service.commit(envelopeFrom(await twoItemWorkbook()), 'user-1'),
    ).rejects.toThrow('observation store unavailable');
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
    // What the document was read into is already durable, and still held.
    expect([...journal.lines.values()].map((line) => line.status)).toEqual([
      'PENDING',
      'PENDING',
    ]);
  });

  it('B0-3 (flipped): one item failing its write no longer prevents capture — or the items after it', async () => {
    // Anchor asserted: the commit rejected and observeMany was never called.
    identity.resolve.mockImplementation(onlyByName(['Tukang Gali']));
    versionService.createVersion
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({ id: 'ver-2' });
    const result = await service.commit(
      envelopeFrom(await twoItemWorkbook()),
      'user-1',
    );
    expect(observations.observeMany).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ workType: '1.7.7.1.1.b (a)', lineNumber: 1 }),
    ]);
    // The second item is still evaluated and, its only gap being identity, written.
    expect(result.written).toEqual([
      expect.objectContaining({
        workType: 'B.98',
        admission: 'IDENTITY_PENDING',
      }),
    ]);
    const [first, second] = journal.linesOf(result.importJobId);
    expect(first).toMatchObject({
      status: 'FAILED',
      errorMessage: 'database unavailable',
      ahspId: null,
    });
    expect(second).toMatchObject({
      status: 'COMPLETED',
      ahspVersionId: 'ver-2',
    });
  });

  it('B0-1 (flipped): a component proven by identity but not by unit is not observed, yet its whole work item is durable', async () => {
    // Anchor asserted: nothing about the item survived the commit.
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(
        raw.trim().toUpperCase() === 'M3' ? RESOLVED_UNIT : UNPROVEN_UNIT,
      ),
    );
    const result = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    expect(result.written).toEqual([]);
    // Observation stays what it is: a home for UNIDENTIFIED resources only.
    expect(observations.observeMany).not.toHaveBeenCalled();
    const [line] = journal.linesOf(result.importJobId);
    expect(line.status).toBe('PENDING');
    expect(line.reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(
      line.knowledge.resources.map((resource) => [
        resource.rawName,
        resource.rawUnit,
        resource.coefficient,
      ]),
    ).toEqual([
      ['Pekerja', 'OH', 0.4],
      ['Mandor', 'OH', 0.04],
    ]);
    expect(result.summary).toMatchObject({
      evaluated: 1,
      held: 1,
      ready: 0,
      identityPending: 0,
    });
  });

  // ── IMPORT-SEAM-08 — one work item is written whole or not at all ──

  it('B0-9 (flipped): the parent, its version, their audit and the intake line share ONE transaction', async () => {
    // Anchor asserted: the parent was created with no transaction to roll it back.
    versionService.createVersion.mockRejectedValue(
      new Error('version write failed'),
    );
    const result = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    // Both writers ran on the SAME transaction client, so the version's failure
    // rolls the parent back with it.
    expect(callArgument(ahspService.create, 0, 1)).toBe(tx);
    expect(callArgument(versionService.createVersion, 0, 2)).toBe(tx);
    expect(result.written).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(journal.linesOf(result.importJobId)[0]).toMatchObject({
      status: 'FAILED',
      ahspId: null,
      ahspVersionId: null,
    });
  });

  it('IMPORT-SEAM-08: an identical AHSP appearing mid-write holds the item instead of failing it', async () => {
    ahspService.create.mockRejectedValue(
      new ConflictException('AHSP_SOURCE_IDENTITY_EXISTS'),
    );
    const result = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    expect(result.failed).toEqual([]);
    expect(result.skipped[0].reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY,
    ]);
    expect(journal.linesOf(result.importJobId)[0].status).toBe('PENDING');
  });

  // ── IMPORT-SEAM-01 — unresolved identity no longer erases a whole recipe ──

  it('B0-4 (flipped): a recipe whose ONLY gap is identity is written as IDENTITY_PENDING', async () => {
    // Anchor asserted: skipped whole with RESOURCE_UNRESOLVED, create not called.
    identity.resolve.mockResolvedValue(unknown);
    const result = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    expect(result.written).toEqual([
      expect.objectContaining({
        admission: 'IDENTITY_PENDING',
        identityPendingResources: 2,
      }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(journal.linesOf(result.importJobId)[0]).toMatchObject({
      status: 'COMPLETED',
      ahspId: 'ahsp-1',
      ahspVersionId: 'ver-1',
      reasonCodes: [AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED],
    });
  });

  it.each([
    [
      'a ruled-out 4" row for a 6" source',
      {
        status: 'UNRESOLVED',
        resolvedResourceCatalogId: null,
        reasonCodes: ['SPECIFICATION_CONFLICT'],
        candidates: [
          {
            name: 'Pipa porous diameter 4"',
            resourceCatalogId: 'catalog-pipe-4',
          },
        ],
      },
    ],
    [
      'a weak shared-word possibility',
      {
        status: 'NEEDS_REVIEW',
        resolvedResourceCatalogId: null,
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
        candidates: [{ name: 'Klem biasa', resourceCatalogId: 'catalog-klem' }],
      },
    ],
    [
      'a specific row for generic wording ("Kerikil 2-3 cm" for "Kerikil / Agregat")',
      {
        status: 'NEEDS_REVIEW',
        resolvedResourceCatalogId: null,
        reasonCodes: [
          'STRONG_CANDIDATE_NEEDS_REVIEW',
          'SPECIFICATION_UNPROVED',
        ],
        candidates: [
          { name: 'Kerikil 2-3 cm', resourceCatalogId: 'catalog-kerikil-23' },
        ],
      },
    ],
  ])(
    'IMPORT-SEAM-01: %s is never stored — the source wording is',
    async (_label, verdict) => {
      identity.resolve.mockResolvedValue(verdict);
      const bytes = await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('B10').value = 'Kerikil / Agregat';
      });
      const result = await service.commit(envelopeFrom(bytes), 'user-1');
      expect(result.written).toHaveLength(1);
      const stored = callArgument<{ resources: WrittenResource[] }>(
        versionService.createVersion,
        0,
        1,
      ).resources;
      expect(stored.map((resource) => resource.resourceId)).toEqual([
        'Kerikil / Agregat',
        'Mandor',
      ]);
      const candidateId = verdict.candidates[0].resourceCatalogId;
      expect(JSON.stringify(stored)).not.toContain(candidateId);
      // Nothing is learned from a reading that proved nothing.
      expect(sightings.createMany).not.toHaveBeenCalled();
    },
  );

  it('IMPORT-SEAM-01: source wording shaped like a catalogue id keeps the item HELD — the column would lie about its kind', async () => {
    identity.resolve.mockResolvedValue(unknown);
    const bytes = await buildAhspAnalisaXlsx((sheet) => {
      sheet.getCell('B10').value = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    });
    const result = await service.commit(envelopeFrom(bytes), 'user-1');
    expect(result.written).toEqual([]);
    expect(result.knowledge.workItems[0].admission).toBe('HELD');
    expect(journal.linesOf(result.importJobId)[0].status).toBe('PENDING');
  });

  const removeMissingCoefficient: SheetMutation = (sheet) => {
    sheet.getCell('G10').value = null;
  };
  const removeComponentUnit: SheetMutation = (sheet) => {
    sheet.getCell('F10').value = null;
  };
  // CHANGE NOTE (AHSP COMPLETION §4): the fixture's own title, "Penggalian 1 m3
  // …", STATES its output unit, so dropping the summary alone no longer leaves a
  // block that states none. The title keeps its work and loses only the quantity.
  // TEST_WEAKENING=NO.
  const removeOutputUnit: SheetMutation = (sheet) => {
    sheet.getCell('C5').value =
      'Penggalian tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
    sheet.getCell('B21').value = 'HARGA SATUAN PEKERJAAN (D + E)';
  };

  it.each([
    [
      'a missing coefficient',
      removeMissingCoefficient,
      AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT,
    ],
    [
      'a component with no stated unit',
      removeComponentUnit,
      AHSP_DOCUMENT_REASON.MISSING_UNIT,
    ],
    [
      'no stated output unit',
      removeOutputUnit,
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    ],
  ])(
    'IMPORT-SEAM-01: %s keeps an identity-pending recipe HELD, with every stated fact durable',
    async (_label, mutate, reason) => {
      identity.resolve.mockResolvedValue(unknown);
      const result = await service.commit(
        envelopeFrom(await buildAhspAnalisaXlsx(mutate)),
        'user-1',
      );
      expect(result.written).toEqual([]);
      expect(ahspService.create).not.toHaveBeenCalled();
      const [line] = journal.linesOf(result.importJobId);
      expect(line.status).toBe('PENDING');
      expect(line.reasonCodes).toContain(reason);
      expect(line.knowledge.workType?.raw).toBe('1.7.7.1.1.b (a)');
      expect(result.summary).toMatchObject({ held: 1, identityPending: 0 });
    },
  );

  // ── IMPORT-SEAM-02 — every work item the document was read into is durable ──

  it('B0-8 (flipped): a held work item is rebuildable WITHOUT the file, and yields the same write a fresh commit would', async () => {
    // Anchor asserted: the response had no intake identity and the only write held no work item facts.
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(
        raw.trim().toUpperCase() === 'M3' ? RESOLVED_UNIT : UNPROVEN_UNIT,
      ),
    );
    const bytes = await buildAhspAnalisaXlsx();
    const held = await service.commit(envelopeFrom(bytes), 'user-1');
    expect(held.written).toEqual([]);
    expect(Object.keys(held).sort()).toEqual([
      'failed',
      'importJobId',
      'knowledge',
      'skipped',
      'summary',
      'written',
    ]);

    // The Unit authority now proves "OH". Continue from the journal — the reader is never touched.
    units.resolve.mockResolvedValue(RESOLVED_UNIT);
    const read = jest.spyOn(ReaderRegistry.prototype, 'read');
    const continued = await service.continueImportJob({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      importJobId: held.importJobId,
      userId: 'user-2',
    });
    expect(read).not.toHaveBeenCalled();
    expect(continued.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    const fromJournal = callArgument(versionService.createVersion, 0, 1);
    read.mockRestore();

    // A fresh commit of the same bytes under the same authorities writes the SAME recipe.
    const fresh = build(inMemoryImportJournal());
    await fresh.commit(envelopeFrom(bytes), 'user-2');
    const fromFile = callArgument(versionService.createVersion, 1, 1);
    expect(fromJournal).toEqual(fromFile);
  });

  it('IMPORT-SEAM-02: the same document imported again is the same journal — no second set of lines', async () => {
    identity.resolve.mockResolvedValue(unknown);
    units.resolve.mockResolvedValue(UNPROVEN_UNIT);
    const bytes = await twoItemWorkbook();
    const first = await service.commit(envelopeFrom(bytes), 'user-1');
    const second = await service.commit(envelopeFrom(bytes), 'user-1');
    expect(second.importJobId).toBe(first.importJobId);
    expect(journal.lines.size).toBe(2);
  });

  // ── IMPORT-SEAM-05 — continuation keeps blocked items exactly as they were ──

  it('IMPORT-SEAM-05: continuing a job leaves a still-blocked item unchanged and never guesses its missing fact', async () => {
    identity.resolve.mockResolvedValue(unknown);
    const bytes = await buildAhspAnalisaXlsx(removeOutputUnit);
    const held = await service.commit(envelopeFrom(bytes), 'user-1');
    const before = JSON.stringify(
      journal.linesOf(held.importJobId)[0].knowledge,
    );
    const continued = await service.continueImportJob({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      importJobId: held.importJobId,
      userId: 'user-1',
    });
    expect(continued.written).toEqual([]);
    const [line] = journal.linesOf(held.importJobId);
    expect(line.status).toBe('PENDING');
    expect(line.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(JSON.stringify(line.knowledge)).toBe(before);
  });

  it('IMPORT-SEAM-05: knowledge stored under another contract is never re-evaluated', async () => {
    journal.loadHeld.mockResolvedValueOnce({
      envelope: {
        contractVersion: 'AHSP_DOCUMENT_OLD',
      } as unknown as AhspDocumentEnvelope,
      knowledgeContractVersion: 'AHSP_DOCUMENT_OLD',
      lines: [],
    });
    expect(AHSP_DOCUMENT_CONTRACT_VERSION).not.toBe('AHSP_DOCUMENT_OLD');
    await expect(
      service.continueImportJob({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        importJobId: 'job-x',
        userId: 'user-1',
      }),
    ).rejects.toThrow(
      new ConflictException('AHSP_IMPORT_KNOWLEDGE_CONTRACT_CHANGED'),
    );
  });

  // ── CLOSEOUT TASK 3 — a possible twin is still decidable after a reload ──

  const WORKSPACE = '11111111-1111-4111-8111-111111111111';
  const WORK_TYPE = '1.7.7.1.1.b (a)';
  const METHOD_NAME =
    'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
  /** A live AHSP whose names differ from the document's only by case. */
  const lookAlike = (ahspId = 'existing-1') => ({
    ahspId,
    workspaceId: WORKSPACE,
    workType: WORK_TYPE,
    methodName: METHOD_NAME.toLowerCase(),
    code: null,
    deletedAt: null,
  });
  const decided = (action: 'KEEP_SEPARATE' | 'USE_EXISTING') => [
    { workType: WORK_TYPE, methodName: METHOD_NAME, action },
  ];

  it('TASK 3: a line held for a possible twin is listed with the comparison the preview showed — without the file', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([lookAlike()]);
    const bytes = await buildAhspAnalisaXlsx();
    const shown = await service.preview(envelopeFrom(bytes));
    const held = await service.commit(envelopeFrom(bytes), 'user-1');
    expect(held.skipped[0].reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH,
    ]);

    const read = jest.spyOn(ReaderRegistry.prototype, 'read');
    ahspService.loadIdentitySurface.mockClear();
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    // One surface load for the whole list, through the same classifier.
    expect(ahspService.loadIdentitySurface).toHaveBeenCalledTimes(1);
    expect(job.waiting).toEqual([
      expect.objectContaining({
        workType: WORK_TYPE,
        methodName: METHOD_NAME,
        identityVerdict: 'POSSIBLY_IDENTICAL',
        identityMatches: shown.workItems[0].identityMatches,
      }),
    ]);
    expect(shown.workItems[0].identityVerdict).toBe('POSSIBLY_IDENTICAL');
  });

  it('TASK 3: a line waiting for anything else is listed as it was, and no comparison is asked', async () => {
    const held = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx(removeOutputUnit)),
      'user-1',
    );
    expect(held.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    ahspService.loadIdentitySurface.mockClear();
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    expect(ahspService.loadIdentitySurface).not.toHaveBeenCalled();
    expect(job.waiting[0]).not.toHaveProperty('identityVerdict');
  });

  it('TASK 3: KEEP_SEPARATE made after a reload is carried by the continuation — written once, the same recipe a fresh commit writes', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([lookAlike()]);
    const bytes = await buildAhspAnalisaXlsx();
    const held = await service.commit(envelopeFrom(bytes), 'user-1');
    expect(ahspService.create).not.toHaveBeenCalled();

    const read = jest.spyOn(ReaderRegistry.prototype, 'read');
    const continued = await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-1',
      decisions: decided('KEEP_SEPARATE'),
    });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(continued.written).toEqual([
      expect.objectContaining({ workType: WORK_TYPE, ahspId: 'ahsp-1' }),
    ]);
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ahspId: 'ahsp-1',
        action: 'AHSPImportKeptSeparate',
        who: 'user-1',
      }),
    );
    expect(journal.linesOf(held.importJobId)[0]).toMatchObject({
      status: 'COMPLETED',
      ahspId: 'ahsp-1',
    });

    // The same decision sent again finds nothing waiting: one decision, one row.
    const again = await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-1',
      decisions: decided('KEEP_SEPARATE'),
    });
    expect(again.written).toEqual([]);
    expect(ahspService.create).toHaveBeenCalledTimes(1);

    // The stored door and the preview door write the same recipe.
    const fromJournal = callArgument(versionService.createVersion, 0, 1);
    await build(inMemoryImportJournal()).commit(
      envelopeFrom(bytes),
      'user-1',
      decided('KEEP_SEPARATE'),
    );
    expect(callArgument(versionService.createVersion, 1, 1)).toEqual(
      fromJournal,
    );
  });

  it('TASK 3: USE_EXISTING made after a reload adopts the one live look-alike and creates nothing', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([lookAlike()]);
    const held = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    const continued = await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-2',
      decisions: decided('USE_EXISTING'),
    });
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(continued.summary).toMatchObject({ alreadyPresent: 1, held: 0 });
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ahspId: 'existing-1',
        action: 'AHSPImportUsedExisting',
        who: 'user-2',
      }),
      expect.anything(),
    );
    expect(journal.linesOf(held.importJobId)[0]).toMatchObject({
      status: 'COMPLETED',
      ahspId: 'existing-1',
    });
  });

  it('TASK 3: with several look-alikes a stored USE_EXISTING is refused exactly as on the preview path', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([
      lookAlike('existing-1'),
      { ...lookAlike('existing-2'), workType: WORK_TYPE.toUpperCase() },
    ]);
    const held = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    const continued = await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-1',
      decisions: decided('USE_EXISTING'),
    });
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(continued.skipped[0].reasonCodes).toEqual([
      AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH,
    ]);
    expect(audit.logAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPImportUsedExisting' }),
      expect.anything(),
    );
    expect(journal.linesOf(held.importJobId)[0].status).toBe('PENDING');
  });

  // ── AHSP COMPLETION §5/§17 — the output unit a title states, weighed at resolution ──

  /** The fixture's block under a title stating its own quantity, over the given summary. */
  const titled =
    (title: string, summary: string): SheetMutation =>
    (sheet) => {
      sheet.getCell('C5').value = title;
      sheet.getCell('B21').value = summary;
    };
  /** A Unit Kernel that knows these spellings, each as the named unit definition. */
  const unitsKnowing = (definitions: Record<string, string>) => (raw: string) =>
    Promise.resolve(
      definitions[raw] !== undefined
        ? {
            status: UNIT_RESOLUTION_STATUS.RESOLVED,
            sourceUnitDefinition: { id: definitions[raw] },
          }
        : UNPROVEN_UNIT,
    );

  it('§5: a title-only output unit goes through the Unit Kernel and is written with the spelling the title used', async () => {
    units.resolve.mockImplementation(
      unitsKnowing({ M2: 'unit-m2', OH: 'unit-oh' }),
    );
    const result = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'PEMASANGAN 1 M2 PLESTERAN DINDING',
            'HARGA SATUAN PEKERJAAN (D + E)',
          ),
        ),
      ),
      'user-1',
    );
    expect(units.resolve).toHaveBeenCalledWith('M2', 'M2');
    expect(result.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    expect(
      callArgument<{ outputUnit: string }>(versionService.createVersion, 0, 1)
        .outputUnit,
    ).toBe('M2');
  });

  it('§17: title "1 M2" over summary "per - m3" is held as a source conflict — nothing written, both statements durable', async () => {
    units.resolve.mockImplementation(
      unitsKnowing({ M2: 'unit-m2', m3: 'unit-m3', OH: 'unit-oh' }),
    );
    const result = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'PEMASANGAN 1 M2 PLESTERAN DINDING',
            'Harga Satuan Pekerjaan per - m3 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    const [line] = journal.linesOf(result.importJobId);
    expect(line.status).toBe('PENDING');
    expect(line.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(line.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(line.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED,
    );
    expect(
      line.knowledge.outputUnitStatements?.map((statement) => statement.raw),
    ).toEqual(['m3', 'M2']);
    expect(result.knowledge.workItems[0]).toMatchObject({
      outputUnitRaw: null,
      resolvedOutputUnit: null,
      admission: 'HELD',
    });
  });

  it('§5: two spellings the Unit Kernel proves to be ONE unit agree — the first statement is used, the conflict cleared', async () => {
    // "m1" and "m'" are one unit to the kernel; the document's spelling differs only.
    units.resolve.mockImplementation(
      unitsKnowing({ m1: 'unit-m', "m'": 'unit-m', OH: 'unit-oh' }),
    );
    const result = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            "Pemasangan 1 m' pipa drainase",
            'Harga Satuan Pekerjaan per - m1 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    expect(result.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    const [item] = result.knowledge.workItems;
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(item.outputUnitRaw).toMatchObject({ raw: 'm1', locator: 'B21' });
    expect(
      item.outputUnitStatements?.map((statement) => statement.raw),
    ).toEqual(['m1', "m'"]);
    expect(
      callArgument<{ outputUnit: string }>(versionService.createVersion, 0, 1)
        .outputUnit,
    ).toBe('m1');
  });

  it('§5: the Owner file\'s "1 m³" over "per - m3" — only the Unit Kernel says they are one unit, and then it is written', async () => {
    units.resolve.mockImplementation(
      unitsKnowing({ m3: 'unit-m3', 'm³': 'unit-m3', OH: 'unit-oh' }),
    );
    const result = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'Pembuatan s.d Pengecoran 1 m³ beton mutu sedang',
            'Harga Satuan Pekerjaan per - m3 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    // Understood as two spellings; resolved as one unit.
    expect(
      journal.linesOf(result.importJobId)[0].knowledge.reasonCodes,
    ).toContain(AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT);
    expect(units.resolve).toHaveBeenCalledWith('m³', 'm³');
    expect(result.written).toEqual([
      expect.objectContaining({ admission: 'PROVEN' }),
    ]);
    expect(
      callArgument<{ outputUnit: string }>(versionService.createVersion, 0, 1)
        .outputUnit,
    ).toBe('m3');
  });

  it('§5-B: when the kernel does not know one spelling, sameness is unproven — the item waits for that unit, nothing is chosen, and it is never called a conflict', async () => {
    // CHANGE NOTE (closeout §5): this test expected SOURCE_UNIT_CONFLICT. "bh" is a
    // spelling the Unit Kernel does not know, so it can prove neither that "bh" and
    // "m1" are one unit nor that they are two; calling that a contradiction in the
    // source claimed a difference nobody proved. The item stays HELD, nothing is
    // written and no statement is picked — exactly as before. TEST_WEAKENING=NO.
    units.resolve.mockImplementation(
      unitsKnowing({ m1: 'unit-m', OH: 'unit-oh' }),
    );
    const result = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'Pemasangan 1 bh pipa drainase',
            'Harga Satuan Pekerjaan per - m1 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED,
    );
    expect(result.skipped[0].reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(result.knowledge.workItems[0]).toMatchObject({
      outputUnitRaw: null,
      resolvedOutputUnit: null,
      admission: 'HELD',
    });
    // The line names the one spelling it waits for, and no stated-units contradiction.
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    expect(job.waiting).toEqual([
      expect.objectContaining({ unknownUnits: [{ spelling: 'bh', uses: 1 }] }),
    ]);
    expect(job.waiting[0]).not.toHaveProperty('statedOutputUnits');
  });

  it('§17: a held conflict stays held on "Periksa ulang" — continuation never picks a side', async () => {
    units.resolve.mockImplementation(
      unitsKnowing({ M2: 'unit-m2', m3: 'unit-m3', OH: 'unit-oh' }),
    );
    const held = await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'PEMASANGAN 1 M2 PLESTERAN DINDING',
            'Harga Satuan Pekerjaan per - m3 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    const continued = await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-1',
    });
    expect(continued.written).toEqual([]);
    expect(continued.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(journal.linesOf(held.importJobId)[0].status).toBe('PENDING');
  });

  // ── AHSP COMPLETION §6/§7/§13 — what a saved import still needs, asked of today ──

  /** Both analyses of `twoItemWorkbook`, every component measured in "Bh". */
  const bhWorkbook = () =>
    buildAhspAnalisaXlsx((sheet) => {
      sheet.getCell('F10').value = 'Bh';
      sheet.getCell('F11').value = 'Bh';
      sheet.getCell('A23').value = 'B.98';
      sheet.getCell('C23').value = 'Pekerjaan kedua contoh';
      sheet.getCell('A24').value = 'No.';
      sheet.getCell('B24').value = 'Uraian';
      sheet.getCell('E24').value = 'Kode';
      sheet.getCell('F24').value = 'Satuan';
      sheet.getCell('G24').value = 'Koefisien';
      sheet.getCell('B27').value = 'Tenaga Kerja';
      sheet.getCell('B28').value = 'Tukang Gali';
      sheet.getCell('E28').value = 'L.02';
      sheet.getCell('F28').value = 'Bh';
      sheet.getCell('G28').value = 0.3;
      sheet.getCell('B31').value = 'Harga Satuan Pekerjaan per - m3 (D+E)';
    });

  it('§6: one unknown spelling is asked of the Unit Kernel ONCE, and every line names what it waits for', async () => {
    units.resolve.mockImplementation(unitsKnowing({ m3: 'unit-m3' }));
    const held = await service.commit(
      envelopeFrom(await bhWorkbook()),
      'user-1',
    );
    expect(held.summary).toMatchObject({ held: 2, ready: 0 });
    units.resolve.mockClear();
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    const bhQuestions = units.resolve.mock.calls.filter(
      ([raw]) => raw === 'Bh',
    );
    expect(bhQuestions).toEqual([['Bh', 'Bh', undefined, 'LABOR']]);
    expect(
      job.waiting.map(
        (line) => (line as { unknownUnits?: unknown }).unknownUnits,
      ),
    ).toEqual([[{ spelling: 'Bh', uses: 2 }], [{ spelling: 'Bh', uses: 1 }]]);
    // Nothing is written or settled by reading.
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(
      journal.linesOf(held.importJobId).map((line) => line.status),
    ).toEqual(['PENDING', 'PENDING']);
  });

  it('§8: once the Unit Kernel knows the spelling, the line says the next check moves it — it is not claimed written', async () => {
    units.resolve.mockImplementation(unitsKnowing({ m3: 'unit-m3' }));
    await service.commit(envelopeFrom(await bhWorkbook()), 'user-1');
    units.resolve.mockImplementation(
      unitsKnowing({ m3: 'unit-m3', Bh: 'unit-bh' }),
    );
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    expect(job.waiting).toEqual([
      expect.objectContaining({
        lineNumber: 1,
        status: 'PENDING',
        unitsKnownNow: true,
      }),
      expect.objectContaining({
        lineNumber: 2,
        status: 'PENDING',
        unitsKnownNow: true,
      }),
    ]);
    expect(job.waiting[0]).not.toHaveProperty('unknownUnits');
    expect(job.counts).toMatchObject({ represented: 0, waiting: 2 });
  });

  it('§5: a line held on a source conflict names what each statement says', async () => {
    units.resolve.mockImplementation(
      unitsKnowing({ M2: 'unit-m2', m3: 'unit-m3', OH: 'unit-oh' }),
    );
    await service.commit(
      envelopeFrom(
        await buildAhspAnalisaXlsx(
          titled(
            'PEMASANGAN 1 M2 PLESTERAN DINDING',
            'Harga Satuan Pekerjaan per - m3 (D+E)',
          ),
        ),
      ),
      'user-1',
    );
    const [job] = (await service.listImportJobs(WORKSPACE)).items;
    expect(job.waiting).toEqual([
      expect.objectContaining({ statedOutputUnits: ['m3', 'M2'] }),
    ]);
  });

  it('§7/§13 (P1-A): a written AHSP is complete for the AHSP stage only when the resolver that consumes it identifies every component — an empty queue proves nothing', async () => {
    // CHANGE NOTE (closeout P1-A): this test derived completeness from the curation
    // queue — "no open question, so complete: 2". A question leaving the queue is
    // not an identity: a component curated without teaching, or never observed at
    // all, still carries the source's wording in the recipe, and the resolver that
    // consumes the recipe cannot use it. That assertion was the defect; it now
    // asserts the opposite, and completeness is asked of the consumer's own identity
    // question over the recipe the line points to. TEST_WEAKENING=NO.
    identity.resolve.mockImplementation(onlyByName(['Tukang Gali']));
    const result = await service.commit(
      envelopeFrom(await twoItemWorkbook()),
      'user-1',
    );
    expect(result.summary).toMatchObject({ ready: 1, identityPending: 1 });
    identity.loadEvidence.mockClear();
    identity.resolve.mockClear();
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [{ id: 'catalog-known' }],
      sourceSightings: [],
      reviewedMappings: [],
    });
    const writes = () => [
      ahspService.create.mock.calls.length,
      versionService.createVersion.mock.calls.length,
      journal.settleLine.mock.calls.length,
      observations.observeMany.mock.calls.length,
    ];
    const writesAfterCommit = writes();
    const question = identicalQuestionKey({
      workspaceId: WORKSPACE,
      resourceType: 'LABOR',
      rawName: 'Tukang Gali',
      rawCode: 'L.02',
      rawUnit: 'OH',
    });
    const sha = result.knowledge.source.contentDigestSha256;
    observations.openQuestionsBySource.mockResolvedValue(
      new Map([[sha, { keys: new Set([question]), uses: 1 }]]),
    );
    const [open] = (await service.listImportJobs(WORKSPACE)).items;
    expect(observations.openQuestionsBySource).toHaveBeenCalledWith(WORKSPACE, [
      sha,
    ]);
    expect(open.completion).toEqual({
      complete: 1,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 1, uses: 1 },
    });
    // ONE evidence load for every listed recipe, with the consumer's GHX subjects
    // and exact questions; each component asked with the consumer's own facts.
    expect(identity.loadEvidence).toHaveBeenCalledTimes(1);
    const [client, scope, subjects, options] = identity.loadEvidence.mock
      .calls[0] as [
      unknown,
      string,
      string[],
      { identicalQuestionKeys: string[] },
    ];
    expect([client, scope, subjects]).toEqual([
      prisma,
      WORKSPACE,
      ['ver-1-resource-1', 'ver-1-resource-2', 'ver-2-resource-1'],
    ]);
    expect(options.identicalQuestionKeys).toContain(question);
    expect(identity.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        ghxSubject: {
          workspaceId: WORKSPACE,
          ahspResourceId: 'ver-2-resource-1',
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        },
      }),
      {
        rawName: 'Tukang Gali',
        rawCode: 'L.02',
        rawUnit: 'OH',
        resourceType: 'LABOR',
        resourceCatalogId: null,
      },
    );

    // The question LEFT the queue — curated without teaching, or never observed.
    // The queue is empty; the consumer still cannot identify "Tukang Gali".
    observations.openQuestionsBySource.mockResolvedValue(new Map());
    const [queueEmpty] = (await service.listImportJobs(WORKSPACE)).items;
    expect(queueEmpty.completion).toEqual({
      complete: 1,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });

    // Only when the identity authority identifies the component TODAY is it complete.
    identity.resolve.mockResolvedValue(proven);
    const [identified] = (await service.listImportJobs(WORKSPACE)).items;
    expect(identified.completion).toMatchObject({
      complete: 2,
      awaitingIdentity: 0,
    });
    // A verdict naming a row the evidence does not hold is not an identity.
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      resolvedResourceCatalogId: 'catalog-elsewhere',
    });
    const [unheld] = (await service.listImportJobs(WORKSPACE)).items;
    expect(unheld.completion).toMatchObject({
      complete: 0,
      awaitingIdentity: 2,
    });
    // Reading wrote nothing, and the listed shape keeps the document's digest to itself.
    expect(writes()).toEqual(writesAfterCommit);
    expect(identified).not.toHaveProperty('sourceSha256');
  });

  it('P1-A(6): an AHSP SIMPROK already held completes a line only through the recipe it lawfully offers today — none, not complete', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([lookAlike()]);
    const held = await service.commit(
      envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
    );
    await service.continueImportJob({
      workspaceId: WORKSPACE,
      importJobId: held.importJobId,
      userId: 'user-2',
      decisions: decided('USE_EXISTING'),
    });
    expect(journal.linesOf(held.importJobId)[0]).toMatchObject({
      status: 'COMPLETED',
      ahspId: 'existing-1',
      ahspVersionId: null,
    });

    // The adopted AHSP offers no version at all: saved, never complete.
    const [withoutRecipe] = (await service.listImportJobs(WORKSPACE)).items;
    expect(withoutRecipe.completion).toEqual({
      complete: 0,
      awaitingIdentity: 0,
      recipeNotUsable: 1,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
    const [query] = aHSPVersion.findMany.mock.calls.map(
      ([args]) => args.where.AND,
    );
    expect(query[0]).toEqual({ ahspId: { in: ['existing-1'] } });

    // A recipe whose unit the Unit Kernel cannot prove is not usable either.
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [{ id: 'catalog-known' }],
      sourceSightings: [],
      reviewedMappings: [],
    });
    await storeVersion('existing-1', {
      outputUnit: 'm3',
      resources: [
        {
          resourceId: 'catalog-known',
          resourceType: 'LABOR',
          coefficient: 0.4,
          baseUnit: 'OJ',
          rawName: 'Pekerja',
          rawCode: 'L.01',
          rawUnit: 'OJ',
        },
      ],
    });
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(raw === 'OJ' ? UNPROVEN_UNIT : RESOLVED_UNIT),
    );
    const [unprovenUnit] = (await service.listImportJobs(WORKSPACE)).items;
    expect(unprovenUnit.completion).toMatchObject({
      complete: 0,
      recipeNotUsable: 1,
    });

    // It offers a whole recipe whose every component the consumer identifies: complete.
    units.resolve.mockResolvedValue(RESOLVED_UNIT);
    const [withRecipe] = (await service.listImportJobs(WORKSPACE)).items;
    expect(withRecipe.completion).toMatchObject({
      complete: 1,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
    });
  });
});

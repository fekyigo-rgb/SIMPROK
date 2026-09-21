import { Test, TestingModule } from '@nestjs/testing';
import {
  AhspVersionStatus,
  LocationType,
  MethodType,
  ResourceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionService } from './ahsp-version.service';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';

describe('AhspVersionService', () => {
  let service: AhspVersionService;
  let prisma: {
    aHSP: {
      findUnique: jest.Mock;
    };
    aHSPVersion: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: {
    logAction: jest.Mock;
  };
  const units = { resolve: jest.fn() };

  const ahsp = {
    id: 'ahsp-1',
    workspaceId: 'workspace-1',
    ownershipType: 'USER_ASSET',
    workType: 'Concrete Work',
    methodType: MethodType.MANUAL,
    locationType: LocationType.GENERAL,
    methodName: 'Manual concrete mixing',
  };

  const resource = {
    resourceId: 'resource-1',
    resourceType: ResourceType.MATERIAL,
    coefficient: 1.25,
    baseUnit: 'm3',
    conversionFactor: 1,
  };

  const version = {
    id: 'version-1',
    ahspId: ahsp.id,
    workspaceId: ahsp.workspaceId,
    versionNumber: 1,
    status: AhspVersionStatus.DRAFT,
    resources: [resource],
  };

  beforeEach(async () => {
    units.resolve.mockReset();
    prisma = {
      aHSP: {
        findUnique: jest.fn(),
      },
      aHSPVersion: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      // The version being revised is read for its ACG-01 source facts, so a
      // revision cannot erase where each line was born. Empty by default: a
      // prior version with no rows carries nothing forward.
      aHSPResource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    );
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspVersionService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AhspAuditService,
          useValue: audit,
        },
        { provide: UnitKernelService, useValue: units },
      ],
    }).compile();

    service = module.get<AhspVersionService>(AhspVersionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createVersion creates the next draft version and writes audit', async () => {
    units.resolve.mockResolvedValue({ status: 'RESOLVED', sourceUnitDefinition: { id: 'unit-m3' } });
    prisma.aHSP.findUnique.mockResolvedValue(ahsp);
    prisma.aHSPVersion.findFirst.mockResolvedValue({
      ...version,
      versionNumber: 1,
    });
    prisma.aHSPVersion.create.mockResolvedValue({
      ...version,
      versionNumber: 2,
    });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createVersion(ahsp.id, {
        workspaceId: ahsp.workspaceId,
        resources: [{ ...resource, conversionFactor: undefined }],
        outputUnit: 'M3',
        userId: 'user-1',
        regulationReference: 'SNI-001',
        effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      ...version,
      versionNumber: 2,
    });

    expect(prisma.aHSP.findUnique).toHaveBeenCalledWith({
      where: { id: ahsp.id },
    });
    expect(prisma.aHSPVersion.findFirst).toHaveBeenCalledWith({
      where: { ahspId: ahsp.id },
      orderBy: { versionNumber: 'desc' },
    });
    expect(prisma.aHSPVersion.create).toHaveBeenCalledWith({
      data: {
        ahspId: ahsp.id,
        workspaceId: ahsp.workspaceId,
        versionNumber: 2,
        status: AhspVersionStatus.DRAFT,
        regulationReference: 'SNI-001',
        effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
        outputUnit: 'M3',
        outputUnitDefinitionId: 'unit-m3',
        resources: {
          create: [
            {
              resourceId: resource.resourceId,
              resourceType: resource.resourceType,
              coefficient: resource.coefficient,
              baseUnit: resource.baseUnit,
              // ACG-01 CLOSURE 1 — a hand-built recipe states no source facts,
              // and each one is written as an explicit NULL. Never omitted and
              // never borrowed from another column: NULL here means "the source
              // did not say", which is exactly true of a recipe typed by hand.
              rawName: null,
              rawCode: null,
              rawUnit: null,
              sourceSha256: null,
              sourceFileName: null,
              parserContractVersion: null,
              sheetName: null,
              sourceRowNumber: null,
              sourceNameCellAddress: null,
              sourceCodeCellAddress: null,
              sourceUnitCellAddress: null,
            },
          ],
        },
      },
      include: { resources: true },
    });
    expect(audit.logAction).toHaveBeenCalledWith(
      {
        ahspId: ahsp.id,
        ahspVersionId: version.id,
        action: 'AHSPVersionCreated',
        who: 'user-1',
        after: {
          ...version,
          versionNumber: 2,
        },
      },
      prisma,
    );
    expect(prisma.aHSPVersion.findMany).toHaveBeenCalledWith({
      where: {
        ahspId: ahsp.id,
        id: { not: version.id },
        workspaceId: ahsp.workspaceId,
        status: {
          notIn: [
            AhspVersionStatus.PUBLISHED,
            AhspVersionStatus.SUPERSEDED,
            AhspVersionStatus.ARCHIVED,
          ],
        },
      },
    });
    expect(prisma.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('IMPORT-SEAM-08: createVersion joins a caller-held transaction instead of opening its own', async () => {
    units.resolve.mockResolvedValue({
      status: 'RESOLVED',
      sourceUnitDefinition: { id: 'unit-m3' },
    });
    const tx = {
      aHSP: { findUnique: jest.fn().mockResolvedValue(ahsp) },
      aHSPVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(version),
        update: jest.fn(),
      },
    };
    await service.createVersion(
      ahsp.id,
      {
        workspaceId: ahsp.workspaceId,
        resources: [{ ...resource, conversionFactor: undefined }],
        outputUnit: 'M3',
        userId: 'user-1',
      },
      tx as any,
    );
    // The parent is read on the caller's transaction, so a parent created
    // earlier in that same transaction is visible here.
    expect(tx.aHSP.findUnique).toHaveBeenCalledWith({ where: { id: ahsp.id } });
    expect(tx.aHSPVersion.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.aHSP.findUnique).not.toHaveBeenCalled();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPVersionCreated' }),
      tx,
    );
  });

  it('createVersion supersedes prior private revisions and leaves PUBLISHED catalog rows', async () => {
    const priorDraft = { ...version, id: 'version-prior-draft', status: AhspVersionStatus.DRAFT };
    const created = { ...version, id: 'version-new', versionNumber: 2 };
    units.resolve.mockResolvedValue({ status: 'RESOLVED', sourceUnitDefinition: { id: 'unit-m3' } });
    prisma.aHSP.findUnique.mockResolvedValue(ahsp);
    prisma.aHSPVersion.findFirst.mockResolvedValue(version);
    prisma.aHSPVersion.create.mockResolvedValue(created);
    prisma.aHSPVersion.findMany.mockResolvedValue([priorDraft]);
    prisma.aHSPVersion.update.mockResolvedValue({
      ...priorDraft,
      status: AhspVersionStatus.SUPERSEDED,
    });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createVersion(ahsp.id, {
        workspaceId: ahsp.workspaceId,
        resources: [{ ...resource, conversionFactor: undefined }],
        outputUnit: 'M3',
        userId: 'user-1',
      }),
    ).resolves.toEqual(created);

    expect(prisma.aHSPVersion.update).toHaveBeenCalledWith({
      where: { id: priorDraft.id },
      data: { status: AhspVersionStatus.SUPERSEDED },
    });
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ahspVersionId: priorDraft.id,
        action: 'AHSPVersionSUPERSEDED',
        reason: 'AHSP_UPDATED',
      }),
      prisma,
    );
  });

  it('createVersion does not supersede Official Repository revisions', async () => {
    units.resolve.mockResolvedValue({ status: 'RESOLVED', sourceUnitDefinition: { id: 'unit-m3' } });
    prisma.aHSP.findUnique.mockResolvedValue({ ...ahsp, workspaceId: null });
    prisma.aHSPVersion.findFirst.mockResolvedValue(null);
    prisma.aHSPVersion.create.mockResolvedValue({ ...version, workspaceId: null });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.createVersion(ahsp.id, {
      workspaceId: 'workspace-1',
      resources: [{ ...resource, conversionFactor: undefined }],
      outputUnit: 'M3',
      userId: 'user-1',
    });

    expect(prisma.aHSPVersion.findMany).not.toHaveBeenCalled();
    expect(prisma.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('updateStatus updates a version status and returns the Prisma result', async () => {
    const updatedVersion = {
      ...version,
      status: AhspVersionStatus.VERIFIED,
    };
    prisma.aHSPVersion.findUnique.mockResolvedValue(version);
    prisma.aHSPVersion.update.mockResolvedValue(updatedVersion);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.updateStatus(
        version.id,
        AhspVersionStatus.VERIFIED,
        'user-1',
        'review complete',
      ),
    ).resolves.toEqual(updatedVersion);

    expect(prisma.aHSPVersion.findUnique).toHaveBeenCalledWith({
      where: { id: version.id },
    });
    expect(prisma.aHSPVersion.update).toHaveBeenCalledWith({
      where: { id: version.id },
      data: { status: AhspVersionStatus.VERIFIED },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: version.ahspId,
      ahspVersionId: version.id,
      action: 'AHSPVersionVERIFIED',
      who: 'user-1',
      before: version,
      after: updatedVersion,
      reason: 'review complete',
    });
  });

  it('rejects legacy conversionFactor and unresolved output unit before writes', async () => {
    await expect(service.createVersion(ahsp.id, { resources: [resource], outputUnit: 'M3', userId: 'user-1' })).rejects.toThrow('LEGACY_CONVERSION_FACTOR_WRITE_FORBIDDEN');
    units.resolve.mockResolvedValue({ status: 'NEEDS_REVIEW' });
    await expect(service.createVersion(ahsp.id, { resources: [{ ...resource, conversionFactor: undefined }], outputUnit: 'unknown', userId: 'user-1' })).rejects.toThrow('AHSP_OUTPUT_UNIT_UNRESOLVED');
    expect(prisma.aHSPVersion.create).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '   '])('rejects missing/null/blank outputUnit %p before resolver or writes', async (outputUnit) => {
    await expect(service.createVersion(ahsp.id, {
      resources: [{ ...resource, conversionFactor: undefined }],
      outputUnit: outputUnit as unknown as string,
      userId: 'user-1',
    })).rejects.toThrow('AHSP_OUTPUT_UNIT_UNRESOLVED');
    expect(units.resolve).not.toHaveBeenCalled();
    expect(prisma.aHSPVersion.create).not.toHaveBeenCalled();
  });

/**
 * GAP C3 — A REVISION MUST NOT ERASE WHERE A LINE WAS BORN.
 *
 * REPRODUCTION OF THE DEFECT (from source, before the fix):
 *   AhspDetailPage.draftsFromVersion keeps only resourceId / resourceType /
 *   coefficient / baseUnit from a stored version, and the save payload sends
 *   exactly those four. createVersion then wrote `r.rawName ?? null` for every
 *   ACG-01 column — so changing ONE coefficient nulled the document trail of the
 *   WHOLE recipe, and the new version read as hand-built when it was not.
 *
 * The fix carries provenance forward on the SERVER, from the version being
 * revised. The client cannot state where a line came from, and an ambiguous
 * identity carries nothing rather than borrowing another row's locator.
 */
describe('ACG-01 / F3 — one coherent origin, or none', () => {
  const AHSP = { id: 'ahsp-1', workspaceId: 'ws-1' };
  const SOURCE = {
    rawName: 'Timbunan Porus',
    rawCode: 'M44',
    rawUnit: 'M3',
    sourceSha256: 'A'.repeat(64),
    sourceFileName: 'AHSP BINA MARGA.xlsx',
    parserContractVersion: 'USI01_XLSX_V1',
    sheetName: 'Sheet1',
    sourceRowNumber: 41,
    sourceNameCellAddress: 'C41',
    sourceCodeCellAddress: 'D41',
    sourceUnitCellAddress: 'E41',
  };
  /** A line the document import wrote into the version now being revised. */
  const priorLine = {
    id: 'line-timbunan',
    ahspVersionId: 'ver-1',
    resourceId: 'cat-timbunan',
    resourceType: 'MATERIAL',
    baseUnit: 'M3',
    ...SOURCE,
  };
  /** What the editor posts back: the four editable fields + the line it continues. */
  const editorLine = {
    resourceId: 'cat-timbunan',
    resourceType: 'MATERIAL',
    coefficient: 1.25,
    baseUnit: 'M3',
    carriedFromResourceLineId: 'line-timbunan',
  };

  const arrange = (
    priorRows,
    latest = { id: 'ver-1', versionNumber: 1 },
    basesById = { 'ver-1': { id: 'ver-1' } },
  ) => {
    units.resolve.mockResolvedValue({
      status: 'RESOLVED',
      sourceUnitDefinition: { id: 'unit-m3' },
    });
    prisma.aHSP.findUnique.mockResolvedValue(AHSP);
    // TWO different queries share this delegate: "the latest version of this
    // AHSP" (ordered, no id) and "this base version, by id". A fixture that
    // answered both with one row could not tell them apart — which is exactly
    // the confusion the base-version rule exists to prevent.
    prisma.aHSPVersion.findFirst.mockImplementation(async (args) => {
      const id = args?.where?.id;
      if (typeof id === 'string') return basesById[id] ?? null;
      return latest;
    });
    prisma.aHSPResource.findMany.mockResolvedValue(priorRows);
    prisma.aHSPVersion.create.mockResolvedValue({ id: 'ver-2', versionNumber: 2, resources: [] });
    prisma.aHSPVersion.findMany.mockResolvedValue([]);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });
  };
  const written = () =>
    prisma.aHSPVersion.create.mock.calls[0][0].data.resources.create;
  const save = (resources, extra = {}, trusted) =>
    service.createVersion(
      AHSP.id,
      {
        workspaceId: AHSP.workspaceId,
        resources,
        outputUnit: 'M3',
        userId: 'user-1',
        ...extra,
      },
      undefined,
      trusted,
    );

  // ------------------------------------------------- E3: a replaced resource

  /**
   * E3 — AN AUTHENTIC LINEAGE IS NOT EVIDENCE FOR A DIFFERENT RESOURCE.
   *
   * The audit's case: a line the import wrote for a MATERIAL priced in M3 is
   * edited so it now names a piece of EQUIPMENT priced by the hour. The prior
   * line is genuinely this line's ancestor — the author continued it — but its
   * provenance describes "Timbunan Porus, M44, Sheet1 row 41". Carrying that
   * forward would hand the equipment a workbook cell that never named it.
   *
   * The substitution is allowed; what is refused is the pretence of a source.
   */
  it('E3: replacing MATERIAL/M3 with EQUIPMENT/Jam keeps NO source facts', async () => {
    arrange([priorLine]);
    await save([
      {
        resourceId: 'cat-excavator',
        resourceType: 'EQUIPMENT',
        coefficient: 0.75,
        baseUnit: 'Jam',
        carriedFromResourceLineId: 'line-timbunan',
      },
    ]);
    const [row] = written();
    // The line is written — the edit is lawful.
    expect(row).toMatchObject({
      resourceId: 'cat-excavator',
      resourceType: 'EQUIPMENT',
      baseUnit: 'Jam',
      coefficient: 0.75,
    });
    // …and it carries the old resource's origin nowhere.
    for (const field of [
      'rawName',
      'rawCode',
      'rawUnit',
      'sourceSha256',
      'sourceFileName',
      'parserContractVersion',
      'sheetName',
      'sourceRowNumber',
      'sourceNameCellAddress',
      'sourceCodeCellAddress',
      'sourceUnitCellAddress',
    ]) {
      expect(row[field]).toBeNull();
    }
  });

  it('E3: changing only the CLASS of the same catalogue row also ends the provenance', async () => {
    arrange([priorLine]);
    await save([{ ...editorLine, resourceType: 'EQUIPMENT' }]);
    expect(written()[0].sourceSha256).toBeNull();
    expect(written()[0].rawName).toBeNull();
  });

  it('E3: the SAME resource keeps its origin — an ordinary coefficient edit is untouched', async () => {
    arrange([priorLine]);
    await save([{ ...editorLine, coefficient: 2.5 }]);
    expect(written()[0]).toMatchObject({
      coefficient: 2.5,
      rawName: 'Timbunan Porus',
      rawCode: 'M44',
      sheetName: 'Sheet1',
      sourceRowNumber: 41,
    });
  });

  it('E3: a replaced line cannot borrow provenance through the request body either', async () => {
    arrange([priorLine]);
    await save([
      {
        resourceId: 'cat-excavator',
        resourceType: 'EQUIPMENT',
        coefficient: 0.75,
        baseUnit: 'Jam',
        carriedFromResourceLineId: 'line-timbunan',
        // The DTO has no provenance; these are extra keys a caller might hope for.
        rawName: 'Timbunan Porus',
        sourceSha256: 'f'.repeat(64),
        sheetName: 'Sheet1',
        sourceRowNumber: 41,
      },
    ]);
    const [row] = written();
    expect(row.rawName).toBeNull();
    expect(row.sourceSha256).toBeNull();
    expect(row.sheetName).toBeNull();
    expect(row.sourceRowNumber).toBeNull();
  });

  // ---------------------------------------------------------------- the defect

  /**
   * THE AUDITOR'S COUNTEREXAMPLE. The prior line was read from document A, code
   * M44, Sheet1 row 41, cell C41. A request omits the digest but states a
   * DIFFERENT code, sheet and row. The old per-field `input ?? inherited` merge
   * composed an origin that never existed — digest A with M144 / ForgedSheet /
   * 999 and the OLD cell address. A locator names one place in one document, or
   * it names none.
   */
  it('F3: a request cannot compose a MIXED origin', async () => {
    arrange([priorLine]);
    await save([
      { ...editorLine, rawCode: 'M144', sheetName: 'ForgedSheet', sourceRowNumber: 999 },
    ]);
    const row = written()[0];
    expect(row.sourceSha256).toBe(SOURCE.sourceSha256);
    // Every column comes from the SAME prior line — nothing from the body.
    expect(row.rawCode).toBe('M44');
    expect(row.sheetName).toBe('Sheet1');
    expect(row.sourceRowNumber).toBe(41);
    expect(row.sourceNameCellAddress).toBe('C41');
  });

  /** And a body that states a COMPLETE provenance is still only a body talking. */
  it('F3: a user edit cannot assert an origin, however complete it looks', async () => {
    arrange([]);
    await save([
      {
        resourceId: 'cat-new',
        resourceType: 'MATERIAL',
        coefficient: 1,
        baseUnit: 'M3',
        rawName: 'Timbunan Porus',
        rawCode: 'M999',
        sourceSha256: 'F'.repeat(64),
        sourceFileName: 'FORGED.xlsx',
        parserContractVersion: 'USI01_XLSX_V1',
        sheetName: 'Forged',
        sourceRowNumber: 1,
        sourceNameCellAddress: 'A1',
      },
    ]);
    const row = written()[0];
    for (const field of Object.keys(SOURCE)) expect(row[field]).toBeNull();
  });

  // ------------------------------------------------------- the lawful roads

  it('THE EDIT ROAD: a resave keeps every ACG-01 column of the line it continues', async () => {
    arrange([priorLine]);
    await save([editorLine]);
    const row = written()[0];
    expect(row.coefficient).toBe(1.25);
    for (const [field, value] of Object.entries(SOURCE)) expect(row[field]).toBe(value);
    expect(prisma.aHSPResource.findMany).toHaveBeenCalledWith({
      where: { ahspVersionId: 'ver-1', id: { in: ['line-timbunan'] } },
    });
  });

  it('THE IMPORT ROAD: the trusted pipeline writes its own reading, whole', async () => {
    arrange([]);
    await save(
      [{ resourceId: 'cat-timbunan', resourceType: 'MATERIAL', coefficient: 1, baseUnit: 'M3' }],
      {},
      { sourceFacts: [SOURCE] },
    );
    const row = written()[0];
    for (const [field, value] of Object.entries(SOURCE)) expect(row[field]).toBe(value);
  });

  it('a trusted pipeline line with NO facts writes nulls, and never borrows from a prior version', async () => {
    arrange([priorLine]);
    await save([editorLine], {}, { sourceFacts: [null] });
    expect(written()[0].sourceSha256).toBeNull();
  });

  it('A HAND-BUILT LINE STAYS HAND-BUILT: no reference, no origin', async () => {
    arrange([priorLine]);
    await save([{ resourceId: 'cat-new', resourceType: 'MATERIAL', coefficient: 1, baseUnit: 'M3' }]);
    expect(written()[0].sourceSha256).toBeNull();
  });

  it('a prior line that was itself hand-built carries its emptiness forward, honestly', async () => {
    arrange([{ id: 'line-manual', ahspVersionId: 'ver-1', resourceId: 'cat-timbunan', resourceType: 'MATERIAL', baseUnit: 'M3' }]);
    await save([{ ...editorLine, carriedFromResourceLineId: 'line-manual' }]);
    const row = written()[0];
    expect(row.sourceSha256).toBeNull();
    expect(row.rawName).toBeNull();
  });

  // ------------------------------------------------------- explicit refusals

  it('a reference to a line that is NOT in the base version is refused, not ignored', async () => {
    arrange([]);
    await expect(
      save([{ ...editorLine, carriedFromResourceLineId: 'line-from-elsewhere' }]),
    ).rejects.toThrow('AHSP_CARRIED_LINE_NOT_IN_BASE_VERSION');
    expect(prisma.aHSPVersion.create).not.toHaveBeenCalled();
  });

  it('two lines cannot claim continuity from the SAME prior line', async () => {
    arrange([priorLine]);
    await expect(
      save([editorLine, { ...editorLine, coefficient: 0.5 }]),
    ).rejects.toThrow('AHSP_CARRIED_LINE_REUSED');
    expect(prisma.aHSPVersion.create).not.toHaveBeenCalled();
  });

  it('a base version that is not this AHSP’s is refused rather than replaced by the latest', async () => {
    arrange([priorLine], { id: 'ver-1', versionNumber: 1 }, {});
    await expect(
      save([editorLine], { basedOnVersionId: 'ver-of-another-ahsp' }),
    ).rejects.toThrow('AHSP_BASE_VERSION_NOT_FOUND');
  });

  // ------------------------------------------------------- shapes that matter

  it('SAVING FROM AN OLDER VERSION continues THAT version, never the newest', async () => {
    arrange([priorLine], { id: 'ver-5', versionNumber: 5 }, { 'ver-1': { id: 'ver-1' } });
    await save([editorLine], { basedOnVersionId: 'ver-1' });
    // The base was resolved by id, and the lines were read from it — not ver-5.
    expect(prisma.aHSPVersion.findFirst).toHaveBeenCalledWith({
      where: { id: 'ver-1', ahspId: AHSP.id },
      select: { id: true },
    });
    expect(prisma.aHSPResource.findMany).toHaveBeenCalledWith({
      where: { ahspVersionId: 'ver-1', id: { in: ['line-timbunan'] } },
    });
  });

  it('DUPLICATION is lawful: two lines for one resource keep their OWN origins', async () => {
    const second = { ...priorLine, id: 'line-timbunan-2', sourceRowNumber: 77, sourceNameCellAddress: 'C77' };
    arrange([priorLine, second]);
    await save([
      editorLine,
      { ...editorLine, coefficient: 0.5, carriedFromResourceLineId: 'line-timbunan-2' },
    ]);
    const rows = written();
    expect(rows[0].sourceRowNumber).toBe(41);
    expect(rows[1].sourceRowNumber).toBe(77);
  });

  it('REORDER follows the line, not the position', async () => {
    const pasir = { ...priorLine, id: 'line-pasir', resourceId: 'cat-pasir', rawName: 'Pasir', rawCode: 'M10b', sourceRowNumber: 88 };
    arrange([priorLine, pasir]);
    await save([
      { ...editorLine, resourceId: 'cat-pasir', carriedFromResourceLineId: 'line-pasir' },
      editorLine,
    ]);
    const rows = written();
    expect(rows[0].rawCode).toBe('M10b');
    expect(rows[1].rawCode).toBe('M44');
  });

  it('DELETE THEN ADD the same resource: the added line is manual, and says so', async () => {
    arrange([priorLine]);
    await save([{ resourceId: 'cat-timbunan', resourceType: 'MATERIAL', coefficient: 2, baseUnit: 'M3' }]);
    expect(written()[0].sourceSha256).toBeNull();
  });

  it('each line is read for its OWN origin when a recipe has several components', async () => {
    const pasir = { ...priorLine, id: 'line-pasir', resourceId: 'cat-pasir', rawName: 'Pasir', rawCode: 'M10b', sourceRowNumber: 42 };
    arrange([priorLine, pasir]);
    await save([
      editorLine,
      { ...editorLine, resourceId: 'cat-pasir', coefficient: 0.5, carriedFromResourceLineId: 'line-pasir' },
    ]);
    const rows = written();
    expect(rows[0].rawCode).toBe('M44');
    expect(rows[1].rawCode).toBe('M10b');
    expect(rows[1].sourceRowNumber).toBe(42);
  });

  it('the catalogue id is NOT occurrence identity: the same resource id alone carries nothing', async () => {
    arrange([priorLine]);
    // No carriedFromResourceLineId — matching by resourceId would have carried.
    await save([{ resourceId: 'cat-timbunan', resourceType: 'MATERIAL', coefficient: 1.25, baseUnit: 'M3' }]);
    expect(written()[0].sourceSha256).toBeNull();
  });
});
});

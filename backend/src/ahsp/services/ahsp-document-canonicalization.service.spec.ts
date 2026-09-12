import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import { AHSP_DOCUMENT_REASON } from '../document/ahsp-document-knowledge';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';

function resolvedUnit() {
  return {
    status: UNIT_RESOLUTION_STATUS.RESOLVED,
    sourceUnitDefinition: { id: 'unit-1' },
  };
}

describe('AhspDocumentCanonicalizationService', () => {
  const ahspService = { create: jest.fn(), loadIdentitySurface: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = {
    loadEvidence: jest.fn(),
    resolve: jest.fn(),
  };
  // The sighting memory the service now writes proved readings into. Typed, so
  // the assertions below read real fields rather than poking at `any`.
  type SightingWrite = {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  };
  const sightings = {
    createMany: jest.fn<Promise<void>, [SightingWrite]>(),
  };
  const prisma = { resourceSourceIdentity: sightings };
  const observations = { observeMany: jest.fn() };
  const norm = new RealityNormalizationEngine();
  const audit = { logAction: jest.fn() };
  let service: AhspDocumentCanonicalizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    units.resolve.mockResolvedValue(resolvedUnit());
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      resolvedResourceCatalogId: 'catalog-pekerja',
    });
    ahspService.create.mockResolvedValue({ id: 'ahsp-1' });
    ahspService.loadIdentitySurface.mockResolvedValue([]);
    versionService.createVersion.mockResolvedValue({ id: 'ver-1' });
    observations.observeMany.mockResolvedValue(undefined);
    audit.logAction.mockResolvedValue(undefined);
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      prisma as any,
      observations as any,
      norm as any,
      audit as any,
    );
  });

  async function envelopeFrom(bytes: Buffer) {
    return service.sealUpload({
      bytes,
      fileName: 'analisa.xlsx',
      mediaType: null,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      actorAccountId: '33333333-3333-4333-8333-333333333333',
    });
  }

  it('writes READY items through AhspService.create and createVersion, never Prisma AHSP create', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toEqual([
      {
        workType: '1.7.7.1.1.b (a)',
        methodName:
          'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3',
        ahspId: 'ahsp-1',
        versionId: 'ver-1',
      },
    ]);
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
    expect(ahspService.create.mock.calls[0][0].methodType).toBeDefined();
    expect(versionService.createVersion.mock.calls[0][1].resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: 'catalog-pekerja',
          resourceType: 'LABOR',
          coefficient: 0.4,
        }),
      ]),
    );
  });

  /**
   * ACG-01 CLOSURE 1 — WHAT THE DOCUMENT SAID SURVIVES THE WRITE.
   *
   * Before this closure an accepted line kept only the catalog id the import
   * had proved, so the spelling, the code and the cell it was read from were
   * gone the moment the row was written — and the occurrence path had to ask
   * the identity kernel with rawCode null even for a document that stated one.
   */
  it('CLOSURE 1: an accepted resource keeps the source facts it was born from', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    await service.commit(envelope, 'user-1');

    const written = versionService.createVersion.mock.calls[0][1].resources[0];
    // The identity the import proved is unchanged...
    expect(written.resourceId).toBe('catalog-pekerja');
    // ...and now travels beside what the document actually said.
    expect(written.rawName).toBe('Pekerja');
    expect(written.rawUnit).toBe('OH');
    expect(written.sourceSha256).toEqual(expect.any(String));
    expect(written.sourceFileName).toEqual(expect.any(String));
    expect(written.parserContractVersion).toEqual(expect.any(String));
    expect(written.sheetName).toEqual(expect.any(String));
    expect(typeof written.sourceRowNumber).toBe('number');
    expect(written.sourceNameCellAddress).toEqual(expect.any(String));
  });

  /**
   * CLOSURE 2 — the source's own item code is recorded AS a code.
   *
   * It already travelled in `workType` because that is what AHSP identity is
   * keyed on, but no column said "this is the item's code", so no reader could
   * tell a code from a work type. Identity is untouched; this is evidence.
   */
  it('CLOSURE 2: the item code the source stated is recorded on the AHSP', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    await service.commit(envelope, 'user-1');

    const created = ahspService.create.mock.calls[0][0];
    expect(created.code).toBe('1.7.7.1.1.b (a)');
    // Identity keys are unchanged — the code is additive, never a new key.
    expect(created.workType).toBe('1.7.7.1.1.b (a)');
    expect(created.methodName).toBe(
      'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3',
    );
    // Context SIMPROK cannot read from this source stays absent rather than
    // being inferred from a heading.
    expect(created.fieldCategory ?? null).toBeNull();
    expect(created.subCategory ?? null).toBeNull();
    expect(created.classification ?? null).toBeNull();
  });

  it('does not write when resource identity is unresolved', async () => {
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      resolvedResourceCatalogId: null,
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
    );
  });

  it('does not write when the unit kernel cannot resolve', async () => {
    units.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      sourceUnitDefinition: null,
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toEqual(
      expect.arrayContaining([AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED]),
    );
  });

  it('does not overwrite an existing canonical identity', async () => {
    ahspService.create.mockRejectedValue(
      new ConflictException('AHSP_SOURCE_IDENTITY_EXISTS'),
    );
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toEqual([]);
    expect(versionService.createVersion).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY,
    );
  });

  // ── AHSP identity / duplicate intelligence (three-state, human decides) ────

  const FIXTURE_WS = '11111111-1111-4111-8111-111111111111';
  const FIXTURE_WORKTYPE = '1.7.7.1.1.b (a)';
  const FIXTURE_METHOD =
    'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
  const surfaceRow = (over: Record<string, unknown>) => ({
    ahspId: 'existing-1',
    workspaceId: FIXTURE_WS,
    workType: FIXTURE_WORKTYPE,
    methodName: FIXTURE_METHOD,
    code: null,
    deletedAt: null,
    ...over,
  });

  it('attaches the IDENTICAL verdict to the preview so the human can decide before commit', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([surfaceRow({})]);
    const knowledge = await service.preview(await envelopeFrom(await buildAhspAnalisaXlsx()));
    expect(knowledge.workItems[0].identityVerdict).toBe('IDENTICAL');
    expect(knowledge.workItems[0].identityMatches?.[0]?.ahspId).toBe('existing-1');
  });

  it('an IDENTICAL item is NEVER created and NEVER throws — it surfaces DUPLICATE_IDENTITY', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([surfaceRow({})]);
    const result = await service.commit(await envelopeFrom(await buildAhspAnalisaXlsx()), 'user-1');
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(result.skipped[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY);
  });

  it('F: a SOFT-DELETED exact twin is IDENTICAL and never reaches create (no P2002/500 path)', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ deletedAt: new Date('2020-01-01T00:00:00.000Z') }),
    ]);
    const result = await service.commit(await envelopeFrom(await buildAhspAnalisaXlsx()), 'user-1');
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY);
  });

  it('G: USE_EXISTING on an IDENTICAL item creates nothing and records provenance on the existing AHSP', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([surfaceRow({})]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'USE_EXISTING' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ ahspId: 'existing-1', action: 'AHSPImportUsedExisting', who: 'user-1' }),
    );
  });

  it('G2: a USE_EXISTING decision is DURABLE — a failed provenance write surfaces, never silently swallowed', async () => {
    // Nothing is created for use-existing, so this audit row is the ONLY trace of
    // the human's duplicate decision. If it cannot be written, the commit must
    // fail (the human retries) rather than lose the decision.
    ahspService.loadIdentitySurface.mockResolvedValue([surfaceRow({})]);
    audit.logAction.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.commit(
        await envelopeFrom(await buildAhspAnalisaXlsx()),
        'user-1',
        [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'USE_EXISTING' }],
      ),
    ).rejects.toThrow('audit down');
    // NOTE: this document holds a single IDENTICAL item, so asserting that create
    // was not called would be vacuous here (no path could call it). What this test
    // genuinely proves is that the rejection PROPAGATES instead of being swallowed.
    // commit() is not transactional: items written earlier in a longer document
    // stay written, which recordUseExisting's docstring states plainly.
  });

  it('G3: a KEEP_SEPARATE enrichment audit stays best-effort — its failure never fails an otherwise-good commit', async () => {
    // The kept-separate row already carries a durable AHSPCreated entry, so losing
    // the enrichment note corrupts nothing and must not fail the commit.
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ methodName: 'penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3' }),
    ]);
    audit.logAction.mockRejectedValue(new Error('audit down'));
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'KEEP_SEPARATE' }],
    );
    expect(result.written).toHaveLength(1);
  });

  it('G4: USE_EXISTING against a SOFT-DELETED twin adopts nothing, but the human decision is RECORDED as refused, never erased', async () => {
    // `decisions` is free-form multipart input, so the "a deleted twin cannot be
    // adopted" rule the display enforces must also hold when the request is crafted.
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ deletedAt: new Date('2020-01-01T00:00:00.000Z') }),
    ]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'USE_EXISTING' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    // never claims the deleted AHSP was adopted...
    expect(audit.logAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPImportUsedExisting' }),
    );
    // ...but the act of choosing is still reconstructable.
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPImportUsedExistingRefused', who: 'user-1' }),
    );
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY,
    );
  });

  it('G5: USE_EXISTING with MORE THAN ONE candidate is REFUSED server-side — SIMPROK never adopts whichever sorted first', async () => {
    // The display withholds the action when there are several look-alikes; because
    // `decisions` is free-form input the same rule must hold here, or a crafted
    // request would record an adoption of whichever ahspId sorted first.
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ ahspId: 'aaa-first-by-sort', workType: '1.7.7.1.1.B (A)' }),
      surfaceRow({ ahspId: 'zzz-last-by-sort', workType: '1.7.7.1.1.b (A)' }),
    ]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'USE_EXISTING' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPImportUsedExisting' }),
    );
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AHSPImportUsedExistingRefused' }),
    );
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH,
    );
  });

  it('POSSIBLY is HELD by default — never auto-created, surfaced for a human decision', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ methodName: 'penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3' }),
    ]);
    const result = await service.commit(await envelopeFrom(await buildAhspAnalisaXlsx()), 'user-1');
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH);
  });

  it('H: KEEP_SEPARATE on a POSSIBLY item creates the distinct row and records provenance on the new AHSP', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ methodName: 'penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3' }),
    ]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'KEEP_SEPARATE' }],
    );
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(result.written).toHaveLength(1);
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ ahspId: 'ahsp-1', action: 'AHSPImportKeptSeparate', who: 'user-1' }),
    );
  });

  // ── K: a decision can never outlive the document it was made for ──────────

  it('K1: a decision for a work item that is NOT in this document is ignored — the item stays HELD', async () => {
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ methodName: 'penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3' }),
    ]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      // A stale decision carried over from some OTHER document.
      [{ workType: 'Pekerjaan Lain', methodName: 'Uraian lain sama sekali', action: 'KEEP_SEPARATE' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH,
    );
  });

  it('K2: KEEP_SEPARATE is IGNORED when the backend re-derives the item as IDENTICAL — a decision can never bypass identity law', async () => {
    // The verdict is re-derived server-side, so a decision that arrived from a
    // stale preview (when the item still looked POSSIBLY) cannot force a second
    // row onto an identity that already exists.
    ahspService.loadIdentitySurface.mockResolvedValue([surfaceRow({})]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: FIXTURE_WORKTYPE, methodName: FIXTURE_METHOD, action: 'KEEP_SEPARATE' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY,
    );
  });

  // ── L: decision keys cannot collide across a different name split ─────────

  it('L: a decision whose (workType, methodName) split merely CONCATENATES the same never applies to another item', async () => {
    // Under a plain-space separator these two keys are byte-identical:
    //   '1.7.7.1.1.b (a)'            + ' ' + 'Penggalian 1 m3 tanah biasa ...'
    //   '1.7.7.1.1.b (a) Penggalian' + ' ' + '1 m3 tanah biasa ...'
    // The decision map keys on a character a source name can never contain, so the
    // decision below must NOT reach the real item, which therefore stays HELD.
    const splitWorkType = FIXTURE_WORKTYPE + ' Penggalian';
    const splitMethodName = FIXTURE_METHOD.replace(/^Penggalian /, '');
    expect(splitWorkType + ' ' + splitMethodName).toBe(
      FIXTURE_WORKTYPE + ' ' + FIXTURE_METHOD,
    );
    ahspService.loadIdentitySurface.mockResolvedValue([
      surfaceRow({ methodName: 'penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3' }),
    ]);
    const result = await service.commit(
      await envelopeFrom(await buildAhspAnalisaXlsx()),
      'user-1',
      [{ workType: splitWorkType, methodName: splitMethodName, action: 'KEEP_SEPARATE' }],
    );
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH,
    );
  });

  it('does not write when the source proves composition but not output unit', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('B1').value = 'B.13 Pekerjaan saluran contoh';
    sheet.getCell('B3').value = 'No';
    sheet.getCell('C3').value = 'Komponen';
    sheet.getCell('E3').value = 'Satuan';
    sheet.getCell('F3').value = 'Perkiraan Kuantitas';
    sheet.getCell('B4').value = 'A';
    sheet.getCell('C4').value = 'Tenaga';
    sheet.getCell('C5').value = 'Pekerja';
    sheet.getCell('D5').value = 'L01';
    sheet.getCell('E5').value = 'Jam';
    sheet.getCell('F5').value = 0.0607;
    const envelope = await envelopeFrom(Buffer.from(await workbook.xlsx.writeBuffer()));
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toEqual([]);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
  });

  it('writes a proven sibling and leaves an unresolved item unwritten', async () => {
    const envelope = await envelopeFrom(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A23').value = 'B.99';
        sheet.getCell('C23').value = 'Pekerjaan tanpa satuan hasil';
        sheet.getCell('A24').value = 'No.';
        sheet.getCell('B24').value = 'Uraian';
        sheet.getCell('E24').value = 'Kode';
        sheet.getCell('F24').value = 'Satuan';
        sheet.getCell('G24').value = 'Koefisien';
        sheet.getCell('B27').value = 'Tenaga Kerja';
        sheet.getCell('B28').value = 'Pekerja';
        sheet.getCell('E28').value = 'L.01';
        sheet.getCell('F28').value = 'OH';
        sheet.getCell('G28').value = 0.5;
        sheet.getCell('B31').value = 'HARGA SATUAN PEKERJAAN (D + E)';
      }),
    );
    const result = await service.commit(envelope, 'user-1');
    expect(result.written).toHaveLength(1);
    expect(result.written[0].workType).toBe('1.7.7.1.1.b (a)');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].workType).toBe('B.99');
    expect(result.skipped[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
  });

  it('preview never calls the canonical writers', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const knowledge = await service.preview(envelope);
    expect(knowledge.workItems.length).toBeGreaterThan(0);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
  });

  it('refuses empty bytes without writing', async () => {
    await expect(
      service.previewUpload({
        file: { buffer: Buffer.alloc(0), originalname: 'empty.xlsx' },
        workspaceId: '11111111-1111-4111-8111-111111111111',
        actorAccountId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ahspService.create).not.toHaveBeenCalled();
  });

  /**
   * UNRESOLVED IS "NOT YET PROVED", NEVER "NOT THERE".
   *
   * The identity kernel returns candidates on NEEDS_REVIEW and on two of its
   * UNRESOLVED verdicts (SPECIFICATION_CONFLICT, RESOURCE_TYPE_MISMATCH). Every
   * one of those is SIMPROK having found something, so all of them must reach
   * the reader as a found-something, not as a nothing-found.
   */
  async function commitWithCandidateVerdict(status: string) {
    identity.resolve.mockResolvedValue({
      status,
      resolvedResourceCatalogId: null,
      candidates: [
        { name: 'Pekerja', resourceCatalogId: 'catalog-a' },
        { name: 'Pekerja Terampil', resourceCatalogId: 'catalog-b' },
      ],
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    const item = result.knowledge.workItems.find(
      (candidate) => candidate.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(item?.status).toBe('UNRESOLVED');
    expect(item?.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
    );
    // The catalogue names SIMPROK narrowed to are carried, never asserted as
    // the identity — nothing is written and no catalogue id is stored.
    expect(item?.resources[0]?.identityCandidates).toEqual([
      'Pekerja',
      'Pekerja Terampil',
    ]);
    expect(item?.resources[0]?.resolvedResourceCatalogId).toBeNull();
    expect(result.written).toEqual([]);
    expect(versionService.createVersion).not.toHaveBeenCalled();
  }

  it('reports candidates found on a NEEDS_REVIEW verdict', async () => {
    await commitWithCandidateVerdict('NEEDS_REVIEW');
  });

  it('reports candidates found on an UNRESOLVED verdict', async () => {
    await commitWithCandidateVerdict('UNRESOLVED');
  });

  it('says nothing was found only when the kernel truly found nothing', async () => {
    identity.resolve.mockResolvedValue({
      status: 'UNRESOLVED',
      resolvedResourceCatalogId: null,
      candidates: [],
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');

    const item = result.knowledge.workItems.find(
      (candidate) => candidate.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(item?.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
    );
    expect(item?.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
    );
  });

  /**
   * A component held back by its UNIT must say so. This regressed into a work
   * item carrying no reason at all, which commit() then reported as generic
   * ambiguity — telling the reader the document was unclear when SIMPROK knew
   * exactly which question was open.
   */
  it('names an unknown component unit instead of falling back to ambiguity', async () => {
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(
        raw.trim().toUpperCase() === 'M3'
          ? resolvedUnit()
          : { status: 'NEEDS_REVIEW', sourceUnitDefinition: null },
      ),
    );
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');

    const item = result.knowledge.workItems.find(
      (candidate) => candidate.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(item?.status).toBe('UNRESOLVED');
    expect(item?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(result.skipped).not.toHaveLength(0);
    expect(
      result.skipped.every(
        (skipped) =>
          !skipped.reasonCodes.includes(
            AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY,
          ),
      ),
    ).toBe(true);
  });

  /**
   * SIMPROK WORKS HARDER BEFORE IT ASKS A PERSON.
   *
   * An unknown component UNIT used to end the investigation for that component:
   * its identity was never searched, so candidates the catalogue could have
   * offered were never found. "Which resource is this" and "what measure is it
   * in" are different questions, and failing the second is no reason to stop
   * asking the first.
   */
  it('still searches identity when the component unit is unknown', async () => {
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(
        raw.trim().toUpperCase() === 'M3'
          ? resolvedUnit()
          : { status: 'NEEDS_REVIEW', sourceUnitDefinition: null },
      ),
    );
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      resolvedResourceCatalogId: null,
      candidates: [
        { name: 'Pekerja Terampil', resourceCatalogId: 'catalog-b' },
      ],
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    const item = result.knowledge.workItems.find(
      (candidate) => candidate.workType?.raw === '1.7.7.1.1.b (a)',
    );

    // The identity engine WAS asked, and what it found reached the knowledge.
    expect(identity.resolve).toHaveBeenCalled();
    expect(item?.resources[0]?.identityCandidates).toEqual([
      'Pekerja Terampil',
    ]);
    expect(item?.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
    );
    // The unknown unit is still stated, and still blocks the write.
    expect(item?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(result.written).toEqual([]);
    expect(versionService.createVersion).not.toHaveBeenCalled();
  });

  /**
   * Identity proved while the unit is not: the catalogue id is kept, the base
   * unit is NOT invented, and the component still cannot be written.
   */
  it('keeps a proved identity without asserting an unproved base unit', async () => {
    units.resolve.mockImplementation((raw: string) =>
      Promise.resolve(
        raw.trim().toUpperCase() === 'M3'
          ? resolvedUnit()
          : { status: 'NEEDS_REVIEW', sourceUnitDefinition: null },
      ),
    );
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    const result = await service.commit(envelope, 'user-1');
    const item = result.knowledge.workItems.find(
      (candidate) => candidate.workType?.raw === '1.7.7.1.1.b (a)',
    );

    expect(item?.resources[0]?.resolvedResourceCatalogId).toBe(
      'catalog-pekerja',
    );
    expect(item?.resources[0]?.resolvedBaseUnit).toBeNull();
    expect(item?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(result.written).toEqual([]);
  });

  /**
   * SIMPROK LEARNS FROM AN AHSP IT ACCEPTED.
   *
   * The sighting memory is what turns an abbreviation or a variant spelling
   * proved once into a candidate the identity kernel can nominate next time.
   * The AHSP door only ever read it; a committed reading is now written back
   * through the same table and the same contract Basic Price already uses.
   */
  it('records a proved reading into the existing sighting memory', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    await service.commit(envelope, 'user-1');

    expect(sightings.createMany).toHaveBeenCalledTimes(1);
    const call = sightings.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    const row = call.data[0];
    expect(row.resourceCatalogId).toBe('catalog-pekerja');
    expect(row.workspaceId).toBe(envelope.workspaceId);
    expect(row.sourceSha256).toBe(envelope.contentDigestSha256);
    expect(row.sourceFileName).toBe(envelope.fileName);
    expect(typeof row.parserContractVersion).toBe('string');
    expect(row.sourceRowNumber).toBeGreaterThan(0);
    expect(row.sourceSection).toBe('LABOR');
    // The RAW spelling is what makes the memory useful — never a tidied one.
    expect(row.rawName).toBe('Pekerja');
    expect(typeof row.sourceNameCellAddress).toBe('string');
  });

  it('remembers only readings whose identity was proved', async () => {
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      resolvedResourceCatalogId: null,
      candidates: [
        { name: 'Pekerja Terampil', resourceCatalogId: 'catalog-b' },
      ],
    });
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    await service.commit(envelope, 'user-1');

    // Nothing was proved, so nothing is remembered — a candidate is not a fact.
    expect(sightings.createMany).not.toHaveBeenCalled();
  });

  it('learns nothing from a preview — understanding is not acceptance', async () => {
    const envelope = await envelopeFrom(await buildAhspAnalisaXlsx());
    await service.preview(envelope);

    expect(sightings.createMany).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
  });
});

const BINA_MARGA_PATHS = [
  'C:/SIMPROK/data/first-real-input/AHSP BINA MARGA.xlsx',
  'C:/SIMPROK/AHSP BINA MARGA.xlsx',
];
const binaMargaPath = BINA_MARGA_PATHS.find((path) => existsSync(path)) ?? '';
const describeBinaMargaCommit = binaMargaPath ? describe : describe.skip;

describeBinaMargaCommit('AhspDocumentCanonicalizationService — official Bina Marga commit safety', () => {
  const ahspService = { create: jest.fn(), loadIdentitySurface: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = {
    loadEvidence: jest.fn().mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    }),
    resolve: jest.fn().mockResolvedValue({
      status: 'RESOLVED',
      resolvedResourceCatalogId: 'catalog-pekerja',
    }),
  };
  let service: AhspDocumentCanonicalizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    units.resolve.mockResolvedValue({
      status: UNIT_RESOLUTION_STATUS.RESOLVED,
      sourceUnitDefinition: { id: 'unit-1' },
    });
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      resolvedResourceCatalogId: 'catalog-pekerja',
    });
    ahspService.loadIdentitySurface.mockResolvedValue([]);
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      { resourceSourceIdentity: { createMany: jest.fn() } } as any,
      { observeMany: jest.fn() } as any,
      new RealityNormalizationEngine() as any,
      { logAction: jest.fn() } as any,
    );
  });

  it('writes nothing for the official workbook even if identity would resolve', async () => {
    const envelope = service.sealUpload({
      bytes: readFileSync(binaMargaPath),
      fileName: 'AHSP BINA MARGA.xlsx',
      mediaType: null,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      actorAccountId: '33333333-3333-4333-8333-333333333333',
    });
    const result = await service.commit(envelope, 'user-1');
    expect(result.knowledge.workItems).toHaveLength(71);
    expect(result.knowledge.workItems.filter((item) => item.status === 'READY')).toHaveLength(0);
    expect(
      result.skipped.every((item) =>
        item.reasonCodes.includes(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT),
      ),
    ).toBe(true);
    expect(result.written).toEqual([]);
    expect(result.skipped).toHaveLength(71);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
  });
});

const POSITIVE_PATHS = [
  'C:/SIMPROK/data/first-real-input/Copy of AHSP ok(1).xlsx',
  'C:/SIMPROK/Copy of AHSP ok(1).xlsx',
];
// RE-PINNED. The Owner corrected three coefficients in this real input file,
// so its bytes changed and this guard fired exactly as designed. The pin and the
// counts below now describe the file as it stands; the guard's purpose — this
// test speaks for ONE known file, not for any spreadsheet — is unchanged.
const POSITIVE_SHA256 =
  'dc30dd94c921fb612d4b6c6cb2d9e6b29241d2b8dd12714223624b9039f74552';
const positivePath = POSITIVE_PATHS.find((path) => existsSync(path)) ?? '';
const describePositiveCommit = positivePath ? describe : describe.skip;

describePositiveCommit('AhspDocumentCanonicalizationService — Copy of AHSP ok(1).xlsx positive path', () => {
  const ahspService = { create: jest.fn(), loadIdentitySurface: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = {
    loadEvidence: jest.fn(),
    resolve: jest.fn(),
  };
  let service: AhspDocumentCanonicalizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    units.resolve.mockImplementation(async (raw: string) => {
      const token = raw.trim().toUpperCase();
      if (token === 'OH' || token === 'M3') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: `unit-${token.toLowerCase()}` },
        };
      }
      return { status: 'NEEDS_REVIEW', sourceUnitDefinition: null };
    });
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockImplementation(
      async (
        _evidence: unknown,
        sighting: { rawName: string | null; rawCode: string | null },
      ) => {
        if (sighting.rawName === 'Pekerja' && sighting.rawCode === 'L.01') {
          return { status: 'RESOLVED', resolvedResourceCatalogId: 'catalog-pekerja' };
        }
        if (sighting.rawName === 'Mandor' && sighting.rawCode === 'L.04') {
          return { status: 'RESOLVED', resolvedResourceCatalogId: 'catalog-mandor' };
        }
        return { status: 'NEEDS_REVIEW', resolvedResourceCatalogId: null };
      },
    );
    ahspService.create.mockResolvedValue({ id: 'ahsp-positive-1' });
    ahspService.loadIdentitySurface.mockResolvedValue([]);
    versionService.createVersion.mockResolvedValue({ id: 'ver-positive-1' });
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      { resourceSourceIdentity: { createMany: jest.fn() } } as any,
      { observeMany: jest.fn() } as any,
      new RealityNormalizationEngine() as any,
      { logAction: jest.fn() } as any,
    );
  });

  it('writes only the catalog-resolvable READY item through existing writers', async () => {
    const bytes = readFileSync(positivePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(POSITIVE_SHA256);
    const envelope = service.sealUpload({
      bytes,
      fileName: 'Copy of AHSP ok(1).xlsx',
      mediaType: null,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      actorAccountId: '33333333-3333-4333-8333-333333333333',
    });
    const result = await service.commit(envelope, 'user-1');
    expect(result.knowledge.workItems).toHaveLength(17);
    expect(result.knowledge.workItems.filter((item) => item.status === 'READY')).toHaveLength(1);
    expect(result.written).toEqual([
      {
        workType: '1.7.7.1.1.b (a)',
        methodName:
          'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3',
        ahspId: 'ahsp-positive-1',
        versionId: 'ver-positive-1',
      },
    ]);
    expect(result.skipped).toHaveLength(16);
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion.mock.calls[0][1].outputUnit).toBe('m3');
    expect(versionService.createVersion.mock.calls[0][1].resources).toEqual([
      expect.objectContaining({
        resourceId: 'catalog-pekerja',
        resourceType: 'LABOR',
        coefficient: 0.4,
        baseUnit: 'OH',
      }),
      expect.objectContaining({
        resourceId: 'catalog-mandor',
        resourceType: 'LABOR',
        coefficient: 0.04,
        baseUnit: 'OH',
      }),
    ]);
    expect(
      result.skipped.every((item) =>
        item.reasonCodes.some((code) =>
          [
            AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
            AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED,
            AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT,
          ].includes(code),
        ),
      ),
    ).toBe(true);
    expect(
      result.skipped.some((item) =>
        item.reasonCodes.includes(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT),
      ),
    ).toBe(false);
  });
});

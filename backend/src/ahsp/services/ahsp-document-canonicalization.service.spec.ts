import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import { AHSP_DOCUMENT_REASON } from '../document/ahsp-document-knowledge';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';

function resolvedUnit() {
  return {
    status: UNIT_RESOLUTION_STATUS.RESOLVED,
    sourceUnitDefinition: { id: 'unit-1' },
  };
}

describe('AhspDocumentCanonicalizationService', () => {
  const ahspService = { create: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = {
    loadEvidence: jest.fn(),
    resolve: jest.fn(),
  };
  const prisma = {};
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
    versionService.createVersion.mockResolvedValue({ id: 'ver-1' });
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      prisma as any,
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
});

const BINA_MARGA_PATHS = [
  'C:/SIMPROK/data/first-real-input/AHSP BINA MARGA.xlsx',
  'C:/SIMPROK/AHSP BINA MARGA.xlsx',
];
const binaMargaPath = BINA_MARGA_PATHS.find((path) => existsSync(path)) ?? '';
const describeBinaMargaCommit = binaMargaPath ? describe : describe.skip;

describeBinaMargaCommit('AhspDocumentCanonicalizationService — official Bina Marga commit safety', () => {
  const ahspService = { create: jest.fn() };
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
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      {} as any,
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
const POSITIVE_SHA256 =
  'c072b8f6599bfd1a59ecdf2405e9309714e0112fee264d18d915e3a9e60aa192';
const positivePath = POSITIVE_PATHS.find((path) => existsSync(path)) ?? '';
const describePositiveCommit = positivePath ? describe : describe.skip;

describePositiveCommit('AhspDocumentCanonicalizationService — Copy of AHSP ok(1).xlsx positive path', () => {
  const ahspService = { create: jest.fn() };
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
    versionService.createVersion.mockResolvedValue({ id: 'ver-positive-1' });
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      {} as any,
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

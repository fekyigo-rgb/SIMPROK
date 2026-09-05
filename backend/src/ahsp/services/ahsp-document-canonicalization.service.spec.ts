import { existsSync, readFileSync } from 'fs';
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
    expect(result.skipped[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_UNIT);
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
    expect(result.written).toEqual([]);
    expect(result.skipped).toHaveLength(71);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
  });
});

import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';
import { buildAhspAnalisaXlsx } from './ahsp-analisa-xlsx.fixture';
import { AHSP_DOCUMENT_REASON } from './ahsp-document-knowledge';
import { understandAhspDocument } from './ahsp-document-understanding';

const GOLDEN_PATH = 'C:/SIMPROK/data/first-real-input/AHSP ok(1).xlsx';
const GOLDEN_SHA256 =
  'dd877cd8e546a7cbcfe1fa8abafc3db45228a710760df7b47a443df7a6d144a1';

async function understandBuffer(bytes: Buffer, fileName: string) {
  const envelope = testEnvelope(bytes, fileName);
  const read = await ReaderRegistry.default().read(envelope);
  return { envelope, read, knowledge: understandAhspDocument(read, envelope) };
}

describe('AHSP document understanding', () => {
  it('binds columns by header captions and extracts the proven work item', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx(),
      'analisa.xlsx',
    );
    expect(knowledge.status).toBe('READY');
    expect(knowledge.document.authorityProven).toBe(true);
    const item = knowledge.workItems[0];
    expect(item.workType?.raw).toBe('1.7.7.1.1.b (a)');
    expect(item.methodName?.raw).toContain('Penggalian 1 m3 tanah biasa');
    expect(item.outputUnitRaw?.raw).toBe('m3');
    expect(item.resources).toHaveLength(2);
    expect(item.resources[0]).toMatchObject({
      group: 'LABOR',
      rawName: 'Pekerja',
      rawCode: 'L.01',
      rawUnit: 'OH',
      coefficient: 0.4,
      status: 'READY',
    });
    expect(item.resources[1]).toMatchObject({
      group: 'LABOR',
      rawName: 'Mandor',
      rawCode: 'L.04',
      coefficient: 0.04,
      status: 'READY',
    });
    expect(item.resources[0].coefficientEvidence?.locator).toBe('G10');
    expect(knowledge.source.readerId).toBe('XLSX_EXCELJS');
  });

  it('does not treat a price-table workbook as an AHSP analisa', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('HARGA');
    sheet.getCell('A1').value = 'DAFTAR HARGA SATUAN UPAH';
    sheet.getCell('A2').value = 'Nama';
    sheet.getCell('B2').value = 'Harga';
    sheet.getCell('A3').value = 'Pekerja';
    sheet.getCell('B3').value = 1000;
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'price.xlsx',
    );
    expect(knowledge.status).toBe('STRUCTURE_UNSUPPORTED');
    expect(knowledge.reasonCodes).toContain(AHSP_DOCUMENT_REASON.STRUCTURE_UNSUPPORTED);
    expect(knowledge.workItems).toHaveLength(0);
  });

  it('refuses a missing coefficient instead of writing zero', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('G10').value = null;
      }),
      'missing-coef.xlsx',
    );
    const pekerja = knowledge.workItems[0].resources.find((r) => r.rawName === 'Pekerja');
    expect(pekerja?.coefficient).toBeNull();
    expect(pekerja?.status).toBe('UNRESOLVED');
    expect(pekerja?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT);
    expect(knowledge.workItems[0].status).toBe('UNRESOLVED');
  });

  it('refuses a zero coefficient', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('G10').value = 0;
      }),
      'zero-coef.xlsx',
    );
    expect(knowledge.workItems[0].resources[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT,
    );
  });

  it('splits a combined title when the code token and remainder name are both proven', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A5').value =
          'U.4.6.a.3 (a) 1 kg Penulangan kolom, balok, ring balk dan sloof';
        sheet.getCell('C5').value = null;
      }),
      'combined-title.xlsx',
    );
    expect(knowledge.workItems[0].workType?.raw).toBe('U.4.6.a.3 (a)');
    expect(knowledge.workItems[0].methodName?.raw).toBe(
      '1 kg Penulangan kolom, balok, ring balk dan sloof',
    );
    expect(knowledge.workItems[0].reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM,
    );
  });

  it('refuses a single title cell that has no separable work code', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A5').value = 'Pekerjaan tanpa kode yang dapat dipisah';
        sheet.getCell('C5').value = null;
      }),
      'title-without-code.xlsx',
    );
    expect(knowledge.workItems[0].status).toBe('UNRESOLVED');
    expect(knowledge.workItems[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM,
    );
    expect(knowledge.workItems[0].workType).toBeNull();
  });

  it('reads Komponen / Perkiraan Kuantitas with an unlabeled code column and does not invent output unit', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('B1').value = 'B.13 Pekerjaan saluran contoh';
    sheet.getCell('B3').value = 'No';
    sheet.getCell('C3').value = 'Komponen';
    sheet.getCell('E3').value = 'Satuan';
    sheet.getCell('F3').value = 'Perkiraan Kuantitas';
    sheet.getCell('G3').value = 'Harga Satuan (Rp )';
    sheet.getCell('B4').value = 'A';
    sheet.getCell('C4').value = 'Tenaga';
    sheet.getCell('B5').value = '1';
    sheet.getCell('C5').value = 'Pekerja';
    sheet.getCell('D5').value = 'L01';
    sheet.getCell('E5').value = 'Jam';
    sheet.getCell('F5').value = 0.0607;
    sheet.getCell('G5').value = 27643.54;
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'komponen.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.workType?.raw).toBe('B.13');
    expect(item.methodName?.raw).toBe('Pekerjaan saluran contoh');
    expect(item.outputUnitRaw).toBeNull();
    expect(item.reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT);
    expect(item.reasonCodes).not.toContain(AHSP_DOCUMENT_REASON.MISSING_UNIT);
    expect(item.status).toBe('UNRESOLVED');
    expect(item.resources[0]).toMatchObject({
      group: 'LABOR',
      rawName: 'Pekerja',
      rawCode: 'L01',
      rawUnit: 'Jam',
      coefficient: 0.0607,
      status: 'READY',
    });
    expect(item.resources[0].coefficient).not.toBe(27643.54);
  });

  it('marks duplicate source identity without merging', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A23').value = '1.7.7.1.1.b (a)';
        sheet.getCell('C23').value =
          'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
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
        sheet.getCell('B31').value = 'Harga Satuan Pekerjaan per - m3 (D+E)';
      }),
      'duplicate.xlsx',
    );
    expect(knowledge.workItems).toHaveLength(2);
    expect(
      knowledge.workItems.every((item) =>
        item.reasonCodes.includes(AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY),
      ),
    ).toBe(true);
  });

  it('treats an unnamed coefficient after a named row as continuation, not a guess', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('G10').value = null;
        sheet.getCell('B11').value = null;
        sheet.getCell('E11').value = null;
        sheet.getCell('F11').value = null;
        sheet.getCell('G11').value = 0.4;
      }),
      'continuation.xlsx',
    );
    const pekerja = knowledge.workItems[0].resources.find((r) => r.rawName === 'Pekerja');
    expect(pekerja?.coefficient).toBe(0.4);
    expect(pekerja?.status).toBe('READY');
  });

  it('keeps a missing resource satuan as MISSING_UNIT, not as a missing output unit', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('F10').value = null;
      }),
      'missing-resource-unit.xlsx',
    );
    const pekerja = knowledge.workItems[0].resources.find((r) => r.rawName === 'Pekerja');
    expect(pekerja?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_UNIT);
    expect(pekerja?.reasonCodes).not.toContain(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT);
    expect(knowledge.workItems[0].outputUnitRaw?.raw).toBe('m3');
    expect(knowledge.workItems[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_UNIT);
    expect(knowledge.workItems[0].reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
  });

  it('does not copy a resource satuan onto the work output unit', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('B21').value = 'HARGA SATUAN PEKERJAAN (D + E)';
        sheet.getCell('F10').value = 'OH';
        sheet.getCell('F11').value = 'm3';
      }),
      'no-guessed-output-unit.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.outputUnitRaw).toBeNull();
    expect(item.reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT);
    expect(item.status).toBe('UNRESOLVED');
    expect(item.resources[0]).toMatchObject({ rawUnit: 'OH', status: 'READY' });
    expect(item.resources[1]).toMatchObject({ rawUnit: 'm3', status: 'READY' });
  });

  it('keeps a proven sibling when another item is unresolved', async () => {
    const { knowledge } = await understandBuffer(
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
      'mixed-ready-unresolved.xlsx',
    );
    expect(knowledge.workItems).toHaveLength(2);
    const proven = knowledge.workItems.find((item) => item.workType?.raw === '1.7.7.1.1.b (a)');
    const unresolved = knowledge.workItems.find((item) => item.workType?.raw === 'B.99');
    expect(proven?.status).toBe('READY');
    expect(proven?.outputUnitRaw?.raw).toBe('m3');
    expect(unresolved?.status).toBe('UNRESOLVED');
    expect(unresolved?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT);
    expect(unresolved?.resources[0]).toMatchObject({
      rawName: 'Pekerja',
      coefficient: 0.5,
      status: 'READY',
    });
    expect(knowledge.status).toBe('READY');
  });

  it('does not invent methodType or locationType and does not hardcode B1B12 columns', () => {
    const source = readFileSync(join(__dirname, 'ahsp-document-understanding.ts'), 'utf8');
    expect(source).not.toMatch(/methodType/);
    expect(source).not.toMatch(/locationType/);
    expect(source).not.toMatch(/column E =/);
    expect(source).not.toMatch(/MATRIX_COLUMN/);
  });
});

const describeGolden = existsSync(GOLDEN_PATH) ? describe : describe.skip;

describeGolden('AHSP official source — AHSP ok(1).xlsx', () => {
  it('reads the Owner first-real-input AHSP through the existing XLSX reader', async () => {
    const bytes = readFileSync(GOLDEN_PATH);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GOLDEN_SHA256);
    const { knowledge, read } = await understandBuffer(bytes, 'AHSP ok(1).xlsx');
    expect(read.readerId).toBe('XLSX_EXCELJS');
    expect(knowledge.document.regulationReference?.raw).toMatch(/PERMEN PUPR NO\. 1 THN 2022/i);
    expect(knowledge.document.effectiveDate).toBeNull();
    expect(knowledge.reasonCodes).toContain(AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN);
    const penggalian = knowledge.workItems.find(
      (item) => item.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(penggalian).toBeDefined();
    expect(penggalian?.methodName?.raw).toBe(
      'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3',
    );
    expect(penggalian?.outputUnitRaw?.raw).toBe('m3');
    expect(penggalian?.resources.map((r) => r.group)).toEqual(['LABOR', 'LABOR']);
    expect(penggalian?.resources.map((r) => r.coefficient)).toEqual([0.4, 0.04]);
    expect(penggalian?.status).toBe('READY');
    const missingCoef = knowledge.workItems.find(
      (item) => item.workType?.raw === 'TM.01.2.a.2)',
    );
    expect(missingCoef?.status).toBe('UNRESOLVED');
    expect(missingCoef?.resources.some((r) => r.coefficient === null)).toBe(true);
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
const describePositive = positivePath ? describe : describe.skip;

describePositive('AHSP positive source — Copy of AHSP ok(1).xlsx', () => {
  it('reads explicit output units from the named Owner file, not from resource satuan', async () => {
    const bytes = readFileSync(positivePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(POSITIVE_SHA256);
    const { knowledge, read } = await understandBuffer(bytes, 'Copy of AHSP ok(1).xlsx');
    expect(read.readerId).toBe('XLSX_EXCELJS');
    expect(knowledge.workItems).toHaveLength(17);
    expect(knowledge.workItems.filter((item) => item.outputUnitRaw !== null)).toHaveLength(17);
    const penggalian = knowledge.workItems.find(
      (item) => item.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(penggalian?.status).toBe('READY');
    expect(penggalian?.outputUnitRaw?.raw).toBe('m3');
    expect(penggalian?.outputUnitRaw?.raw).not.toBe('OH');
    expect(penggalian?.resources.map((r) => r.rawName)).toEqual(['Pekerja', 'Mandor']);
    expect(penggalian?.resources.map((r) => r.rawUnit)).toEqual(['OH', 'OH']);
    expect(penggalian?.resources.map((r) => r.coefficient)).toEqual([0.4, 0.04]);
    // 16 of 17, and one still short of a coefficient — the correction the Owner
    // made to this file. Understanding is asserted here on the SOURCE alone;
    // whether a resource can be proved against the catalogue is the
    // canonicalisation suite's question, not this one's.
    expect(knowledge.workItems.filter((item) => item.status === 'READY')).toHaveLength(16);
    expect(
      knowledge.workItems.filter((item) =>
        item.reasonCodes.includes(AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT),
      ),
    ).toHaveLength(1);
    expect(
      knowledge.workItems.filter((item) =>
        item.reasonCodes.includes(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT),
      ),
    ).toHaveLength(0);
  });
});

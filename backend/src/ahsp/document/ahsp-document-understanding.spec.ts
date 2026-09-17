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

  // LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION kept the fixture's own title,
  // "Penggalian 1 m3 tanah biasa …". AHSP COMPLETION §4: that title STATES its
  // output unit, so it is no longer a block that states none. The law under test —
  // a component's satuan is never copied onto the work's output unit — is kept by
  // giving the block a title that states no quantity. TEST_WEAKENING=NO.
  it('does not copy a resource satuan onto the work output unit', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('C5').value =
          'Penggalian tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
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

  /**
   * IMPORT-SEAM B8 — a block that states its output unit on its own row above
   * the header, the layout of the Owner's Bina Marga working copy:
   *
   *   B.13 Gorong-gorong ... (2.3.(3c))
   *   satuan : m
   *   No | Komponen | | Satuan | Perkiraan Kuantitas | ...
   *
   * B0 ANCHOR (flipped): the unit row used to be taken as the title, so BOTH
   * stated facts were lost (workType null, MISSING_WORK_ITEM + MISSING_OUTPUT_UNIT).
   */
  const statementBlock = (
    sheet: ExcelJS.Worksheet,
    top: number,
    title: string,
    statement: string | null,
    summary = 'HARGA SATUAN PEKERJAAN (D + E)',
  ) => {
    sheet.getCell(`B${top}`).value = title;
    if (statement) sheet.getCell(`B${top + 1}`).value = statement;
    const header = top + 2;
    sheet.getCell(`B${header}`).value = 'No';
    sheet.getCell(`C${header}`).value = 'Komponen';
    sheet.getCell(`E${header}`).value = 'Satuan';
    sheet.getCell(`F${header}`).value = 'Perkiraan Kuantitas';
    sheet.getCell(`G${header}`).value = 'Harga Satuan (Rp )';
    sheet.getCell(`B${header + 1}`).value = 'A';
    sheet.getCell(`C${header + 1}`).value = 'Tenaga';
    sheet.getCell(`B${header + 2}`).value = '1';
    sheet.getCell(`C${header + 2}`).value = 'Pekerja';
    sheet.getCell(`D${header + 2}`).value = 'L01';
    sheet.getCell(`E${header + 2}`).value = 'Jam';
    sheet.getCell(`F${header + 2}`).value = 0.0607;
    sheet.getCell(`C${header + 3}`).value = summary;
  };

  it('B8: reads the title AND the explicitly stated "satuan : m" of a Bina Marga block', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('B1').value = 'DEVISI 2 BIDANG BINA MARGA';
    statementBlock(
      sheet,
      3,
      'B.13 Gorong-gorong  pipa beton bertulang, diameter dalm 40 cm, landasan bahan porous (2.3.(3c))',
      'satuan : m',
    );
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'bina-marga-statement.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.workType?.raw).toBe('B.13');
    expect(item.workType?.locator).toBe('B3');
    expect(item.methodName?.raw).toMatch(
      /^Gorong-gorong\s+pipa beton bertulang/,
    );
    // The unit is the literal statement, located at the cell that says it.
    expect(item.outputUnitRaw).toMatchObject({
      raw: 'm',
      locator: 'B4',
      rowNumber: 4,
    });
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(item.status).toBe('READY');
  });

  it('B8: a block that states no unit stays MISSING_OUTPUT_UNIT, and never borrows a neighbour statement', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    // First block states nothing; the second block's statement sits inside the
    // first block's body range and must not be read for it.
    statementBlock(
      sheet,
      1,
      'B.82 Pipa Berlubang Banyak, Diameter 6 inci (2.4.(4))',
      null,
    );
    statementBlock(
      sheet,
      10,
      'B.83 Pipa Berlubang Banyak, Diameter 8 inci (2.4.(5))',
      'satuan : m',
    );
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'bina-marga-neighbour.xlsx',
    );
    const first = knowledge.workItems.find(
      (item) => item.workType?.raw === 'B.82',
    );
    const second = knowledge.workItems.find(
      (item) => item.workType?.raw === 'B.83',
    );
    expect(first?.outputUnitRaw).toBeNull();
    expect(first?.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(second?.outputUnitRaw?.raw).toBe('m');
  });

  // LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was SEMANTIC_AMBIGUITY for two
  // statements naming different units. AHSP COMPLETION (§5): a stated-twice conflict
  // is named for what it is — SOURCE_UNIT_CONFLICT — so the reader is told the
  // document says two different things, and so resolution can clear exactly this
  // reason when the Unit Kernel proves two spellings name one unit (a blanket
  // SEMANTIC_AMBIGUITY may have other causes and could never be cleared). Both
  // statements are now also kept. NEW_EXPECTATION: no unit picked, never
  // MISSING_OUTPUT_UNIT, item held. TEST_WEAKENING=NO.
  it('B8: two statements naming different units are a contradiction — no unit is picked', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    statementBlock(
      sheet,
      1,
      'B.13 Gorong-gorong contoh (2.3.(3c))',
      'satuan : m',
      'Harga Satuan Pekerjaan per - m3 (D+E)',
    );
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'bina-marga-contradiction.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.outputUnitRaw).toBeNull();
    expect(item.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(
      item.outputUnitStatements?.map((statement) => statement.raw),
    ).toEqual(['m3', 'm']);
    expect(item.status).toBe('UNRESOLVED');
  });

  /**
   * CLOSEOUT TASK 4 — the B1-B12 transcription prints "Nota :" and numbered
   * notes below each block's closing total, and on a shared sheet the next
   * block's title follows them. None of those rows is a component.
   */
  it('reads nothing below the closing total as a component: notes and the next title stay out', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A22').value = 'Nota :';
        sheet.getCell('A23').value = 1;
        sheet.getCell('B23').value =
          'Satuan dapat berdasarkan atas jam operasi untuk Tenaga Kerja dan Peralatan';
        sheet.getCell('A24').value = 2;
        sheet.getCell('B24').value =
          'Kuantitas satuan adalah kuantitas perkiraan setiap komponen';
        sheet.getCell('A26').value = 'B.10 (2.3.(2))';
        sheet.getCell('B26').value = 'Pekerjaan contoh berikutnya';
        sheet.getCell('A28').value = 'No.';
        sheet.getCell('B28').value = 'Uraian';
        sheet.getCell('E28').value = 'Kode';
        sheet.getCell('F28').value = 'Satuan';
        sheet.getCell('G28').value = 'Koefisien';
        sheet.getCell('A29').value = 'A';
        sheet.getCell('B29').value = 'Tenaga Kerja';
        sheet.getCell('A30').value = 1;
        sheet.getCell('B30').value = 'Pekerja';
        sheet.getCell('E30').value = 'L.01';
        sheet.getCell('F30').value = 'OH';
        sheet.getCell('G30').value = 0.5;
        sheet.getCell('B31').value = 'Harga Satuan Pekerjaan per - m3 (D+E)';
      }),
      'notes-below-total.xlsx',
    );
    const [first, second] = knowledge.workItems;
    expect(first.resources.map((r) => r.rawName)).toEqual([
      'Pekerja',
      'Mandor',
    ]);
    expect(first.reasonCodes).toEqual([]);
    expect(first.status).toBe('READY');
    // The title below the notes is the next block's identity, not a component.
    expect(second.workType?.raw).toBe('B.10 (2.3.(2))');
    expect(second.resources.map((r) => r.rawName)).toEqual(['Pekerja']);
  });

  it('holds the item when a row below the closing total still states a unit or quantity', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A22').value = 3;
        sheet.getCell('B22').value = 'Pasir';
        sheet.getCell('F22').value = 'm3';
        sheet.getCell('G22').value = 0.1;
      }),
      'quantity-below-total.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.resources.map((r) => r.rawName)).toEqual(['Pekerja', 'Mandor']);
    expect(item.reasonCodes).toContain(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);
    expect(item.status).toBe('UNRESOLVED');
  });

  it('files nothing under an unreadable section heading into the previous section', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        // The B1-B12 transcription's "B. | BANAN": a section letter, no fact.
        sheet.getCell('A13').value = 'B.';
        sheet.getCell('B13').value = 'BANAN';
        sheet.getCell('A14').value = 1;
        sheet.getCell('B14').value = 'Semen';
        sheet.getCell('E14').value = 'M.12';
        sheet.getCell('F14').value = 'kg';
        sheet.getCell('G14').value = 0.5;
      }),
      'unreadable-section.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.resources.map((r) => r.rawName)).toEqual([
      'Pekerja',
      'Mandor',
      'Semen',
    ]);
    const semen = item.resources[2];
    // Not LABOR from the section above it, and not BAHAN guessed from a typo.
    expect(semen.group).toBeNull();
    expect(semen.status).toBe('UNRESOLVED');
    expect(semen.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY,
    );
    expect(item.reasonCodes).toContain(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);
    expect(item.status).toBe('UNRESOLVED');
  });

  it('keeps a lettered row as a component when it states its unit and quantity', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        sheet.getCell('A10').value = 'a';
        sheet.getCell('A11').value = 'b';
      }),
      'lettered-components.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.resources.map((r) => r.rawName)).toEqual(['Pekerja', 'Mandor']);
    expect(item.status).toBe('READY');
  });

  it('never reads a text coefficient as a number', async () => {
    const { knowledge } = await understandBuffer(
      await buildAhspAnalisaXlsx((sheet) => {
        // The shape the B1-B12 transcription holds for Pasir in B.3.
        sheet.getCell('G10').value = '"            0,2534';
      }),
      'text-coefficient.xlsx',
    );
    const pekerja = knowledge.workItems[0].resources.find(
      (r) => r.rawName === 'Pekerja',
    );
    expect(pekerja?.coefficient).toBeNull();
    expect(pekerja?.status).toBe('UNRESOLVED');
    expect(pekerja?.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT,
    );
    expect(knowledge.workItems[0].status).toBe('UNRESOLVED');
  });

  it('does not invent methodType or locationType and does not hardcode B1B12 columns', () => {
    const source = readFileSync(join(__dirname, 'ahsp-document-understanding.ts'), 'utf8');
    expect(source).not.toMatch(/methodType/);
    expect(source).not.toMatch(/locationType/);
    expect(source).not.toMatch(/column E =/);
    expect(source).not.toMatch(/MATRIX_COLUMN/);
  });
});

/**
 * AHSP COMPLETION §4/§5/§16/§17 — THE OUTPUT UNIT A WORK TITLE STATES.
 *
 * "PEMASANGAN 1 M2 PLESTERAN DINDING" states that its analysis produces one m2.
 * That statement is read — narrowly — and weighed against every other statement
 * the block makes. A dimension, a strength class or a mix is never an output unit.
 */
describe('AHSP document understanding — the output unit a work title states', () => {
  /** The default analisa block with this title and no "per -" summary statement. */
  const titledBlock = (
    title: string,
    summary = 'HARGA SATUAN PEKERJAAN (D + E)',
  ) =>
    buildAhspAnalisaXlsx((sheet) => {
      sheet.getCell('C5').value = title;
      sheet.getCell('B21').value = summary;
    });

  it.each([
    ['PEMASANGAN 1 M2 PLESTERAN DINDING', 'M2'],
    ['PEMBUATAN 1 M3 BETON MUTU RENDAH', 'M3'],
    ['PEKERJAAN 1 KG PEMBESIAN BETON', 'KG'],
    ['1 m3 Galian Batu dan dimuat ke DT', 'm3'],
    ['Pemasangan 1 m2Plesteran 1SP : 2PP tebal 15 mm', 'm2'],
    ['dan Pengecoran 1 m3 Campuran Beton fc = 25,0 MPa (K-300)', 'm3'],
    ['Pembuatan s.d Pengecoran 1 m³ beton mutu sedang', 'm³'],
  ])(
    'reads the output unit "%s" states, exactly as written, at the title cell',
    async (title, unit) => {
      const { knowledge } = await understandBuffer(
        await titledBlock(title),
        'judul.xlsx',
      );
      const item = knowledge.workItems[0];
      expect(item.methodName?.raw).toBe(title);
      expect(item.outputUnitRaw).toMatchObject({
        raw: unit,
        locator: 'C5',
        rowNumber: 5,
      });
      expect(item.outputUnitStatements).toBeUndefined();
      expect(item.reasonCodes).not.toContain(
        AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
      );
      expect(item.status).toBe('READY');
    },
  );

  it.each([
    'Pipa diameter 6 inch',
    'Beton K-250',
    'Campuran 1:2:3',
    'Plesteran tebal 5 cm',
    'Pemasangan besi jarak 20 cm',
    'Angkutan Tanah Keras dengan Dump Truck Untuk Jarak 1 Km',
    'Pemasangan pipa diameter 1 inch',
    'Pemadatan 1 kg/cm2 lapis pondasi',
    'Pemasangan 10 m2 keramik',
    'Pemasangan 1,5 m2 keramik',
    'Saluran U Pracetak Tipe DS 1A( Dengan  Tutup)',
  ])('never reads "%s" as a statement of the output unit', async (title) => {
    const { knowledge } = await understandBuffer(
      await titledBlock(title),
      'bukan-satuan.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.outputUnitRaw).toBeNull();
    expect(item.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
  });

  it('§17: a title "1 M2" over a summary "per - m3" is a source conflict — held, both kept, neither chosen', async () => {
    const { knowledge } = await understandBuffer(
      await titledBlock(
        'PEMASANGAN 1 M2 PLESTERAN DINDING',
        'Harga Satuan Pekerjaan per - m3 (D+E)',
      ),
      'konflik.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.outputUnitRaw).toBeNull();
    expect(item.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(item.outputUnitStatements).toEqual([
      expect.objectContaining({ raw: 'm3', locator: 'B21' }),
      expect.objectContaining({ raw: 'M2', locator: 'C5' }),
    ]);
    expect(item.status).toBe('UNRESOLVED');
  });

  it('§17: title "1 M2", "satuan : m2" and "per - m2" agree — m2, with every statement kept', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    statementBlockFor(
      sheet,
      'B.13 PEMASANGAN 1 M2 PLESTERAN DINDING',
      'satuan : m2',
      'Harga Satuan Pekerjaan per - m2 (D+E)',
    );
    const { knowledge } = await understandBuffer(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'sepakat.xlsx',
    );
    const item = knowledge.workItems[0];
    expect(item.workType?.raw).toBe('B.13');
    expect(item.outputUnitRaw).toMatchObject({ raw: 'm2', locator: 'C7' });
    expect(
      item.outputUnitStatements?.map((statement) => [
        statement.raw,
        statement.locator,
      ]),
    ).toEqual([
      ['m2', 'C7'],
      ['m2', 'B2'],
      ['M2', 'B1'],
    ]);
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
    expect(item.status).toBe('READY');
  });

  it('two spellings ("1 m³" over "per - m3") are never judged here — kept for the Unit Kernel, and nothing is picked', async () => {
    const { knowledge } = await understandBuffer(
      await titledBlock(
        'Pembuatan s.d Pengecoran 1 m³ beton mutu sedang',
        'Harga Satuan Pekerjaan per - m3 (D+E)',
      ),
      'superskrip.xlsx',
    );
    const item = knowledge.workItems[0];
    // What a spelling MEANS is the Unit Kernel's question (resolution clears this
    // when it proves both name one unit); the reader only sees two spellings.
    expect(item.outputUnitRaw).toBeNull();
    expect(
      item.outputUnitStatements?.map((statement) => statement.raw),
    ).toEqual(['m3', 'm³']);
    expect(item.reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
    );
    expect(item.reasonCodes).not.toContain(
      AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    );
  });

  it('never compares units with the Unit Kernel normalizer — that primitive has its own owners', () => {
    const source = readFileSync(
      join(__dirname, 'ahsp-document-understanding.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/normalizeUnitAlias|unit-kernel/);
  });
});

/** A Bina Marga-style block: combined code + title, a "satuan :" row, the header, one component, a summary. */
function statementBlockFor(
  sheet: ExcelJS.Worksheet,
  title: string,
  statement: string,
  summary: string,
) {
  sheet.getCell('B1').value = title;
  sheet.getCell('B2').value = statement;
  sheet.getCell('B3').value = 'No';
  sheet.getCell('C3').value = 'Komponen';
  sheet.getCell('E3').value = 'Satuan';
  sheet.getCell('F3').value = 'Perkiraan Kuantitas';
  sheet.getCell('B4').value = 'A';
  sheet.getCell('C4').value = 'Tenaga';
  sheet.getCell('B5').value = '1';
  sheet.getCell('C5').value = 'Pekerja';
  sheet.getCell('D5').value = 'L01';
  sheet.getCell('E5').value = 'Jam';
  sheet.getCell('F5').value = 0.0607;
  sheet.getCell('C7').value = summary;
}

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

// LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION was 17 of 17 items with an output
// unit and 16 READY. AHSP COMPLETION §5/§17: this file's titles also state their
// output unit, and five of them contradict the block's own summary — a title
// "Pemasangan 1 m2 …" (or "1 kg Penulangan …") over "Harga Satuan Pekerjaan per -
// m3". Under the Owner's conflict law those five are no longer given the summary's
// m3 silently: they are held with SOURCE_UNIT_CONFLICT and both statements kept. A
// sixth title spells the summary's unit differently ("1 m³" over "per - m3"); this
// reader keeps both spellings for the Unit Kernel, which clears it at resolution
// (asserted in the acceptance-boundary suite). The file's bytes are unchanged (same
// pin). NEW_EXPECTATION: 11 with an output unit at understanding, 10 READY, six
// items with two spellings of which five are genuine conflicts, still no
// MISSING_OUTPUT_UNIT. TEST_WEAKENING=NO.
describePositive('AHSP positive source — Copy of AHSP ok(1).xlsx', () => {
  it('reads explicit output units from the named Owner file, not from resource satuan', async () => {
    const bytes = readFileSync(positivePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(POSITIVE_SHA256);
    const { knowledge, read } = await understandBuffer(bytes, 'Copy of AHSP ok(1).xlsx');
    expect(read.readerId).toBe('XLSX_EXCELJS');
    expect(knowledge.workItems).toHaveLength(17);
    expect(
      knowledge.workItems.filter((item) => item.outputUnitRaw !== null),
    ).toHaveLength(11);
    const conflicts = knowledge.workItems.filter((item) =>
      item.reasonCodes.includes(AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT),
    );
    expect(
      conflicts.map((item) => [
        item.workType?.raw,
        item.outputUnitStatements?.map((statement) => statement.raw),
      ]),
    ).toEqual([
      ['U.4.6.a.3 (a)', ['m3', 'kg']],
      ['U.4.2.b.2.2 (a)', ['m3', 'm³']],
      ['3.2.1.(c)', ['m3', 'm2']],
      ['3.2.1.(d)', ['m3', 'm2']],
      ['3.2.2.(c)', ['m3', 'm2']],
      ['3.3.10.(c)', ['m3', 'm2']],
    ]);
    expect(conflicts.every((item) => item.outputUnitRaw === null)).toBe(true);
    const penggalian = knowledge.workItems.find(
      (item) => item.workType?.raw === '1.7.7.1.1.b (a)',
    );
    expect(penggalian?.status).toBe('READY');
    expect(penggalian?.outputUnitRaw?.raw).toBe('m3');
    expect(penggalian?.outputUnitRaw?.raw).not.toBe('OH');
    expect(penggalian?.resources.map((r) => r.rawName)).toEqual(['Pekerja', 'Mandor']);
    expect(penggalian?.resources.map((r) => r.rawUnit)).toEqual(['OH', 'OH']);
    expect(penggalian?.resources.map((r) => r.coefficient)).toEqual([0.4, 0.04]);
    // 10 of 17: one still short of a coefficient — the correction the Owner made
    // to this file — and the six items with two spellings above. Understanding is
    // asserted here on the SOURCE alone; whether a resource can be proved against
    // the catalogue, or two spellings name one unit, is the resolution's question.
    expect(
      knowledge.workItems.filter((item) => item.status === 'READY'),
    ).toHaveLength(10);
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

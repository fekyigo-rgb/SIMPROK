import ExcelJS from 'exceljs';
import { XLSX_READER_DIAGNOSTICS, XlsxSourceReader } from './xlsx.reader';
import { textAt } from './source-table';
import {
  DIALECT_FIXTURE_CELLS,
  DIALECT_FIXTURE_SHEET,
  buildPlainDialectXlsx,
  buildPrefixedDialectXlsx,
} from '../../../test/fixtures/ooxml-dialect.fixture';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R3 §10 — XLSX_OOXML_DIALECT_PORTABLE_REGRESSION.
 *
 * The Owner's real IKK workbook exposed a reader limitation, not a fault in
 * their document. That repair is now protected by a synthetic fixture carrying
 * three invented cells, so CI keeps the guarantee on a machine that has never
 * seen — and must never store — the Owner's business data.
 */
describe('XLSX reader — OOXML dialect normalization', () => {
  const reader = new XlsxSourceReader();
  let plain: Buffer;
  let prefixed: Buffer;

  beforeAll(async () => {
    plain = await buildPlainDialectXlsx();
    prefixed = await buildPrefixedDialectXlsx();
  });

  it('the fixture genuinely reproduces the defect: plain ExcelJS cannot read it', async () => {
    // Without this the suite would only prove the reader agrees with itself.
    const workbook = new ExcelJS.Workbook();
    let failed = false;
    try {
      await workbook.xlsx.load(prefixed as any);
      // If it loads at all, it must at least have lost the sheet — which is the
      // symptom the real workbook showed.
      failed = workbook.worksheets.length === 0;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);

    // ...and the SAME workbook in ordinary form loads perfectly, proving the
    // dialect is the only difference.
    const control = new ExcelJS.Workbook();
    await control.xlsx.load(plain as any);
    expect(control.worksheets.map((s) => s.name)).toEqual([DIALECT_FIXTURE_SHEET]);
  });

  it('SIMPROK reads it, and says that it had to adapt', async () => {
    const read = await reader.read(testEnvelope(prefixed, 'dialect.xlsx'));

    expect(read.readerDiagnostics).toContain(
      XLSX_READER_DIAGNOSTICS.OOXML_DIALECT_NORMALIZED,
    );
    expect(read.tables.map((t) => t.name)).toEqual([DIALECT_FIXTURE_SHEET]);
  });

  it('every cell value survives the normalization unchanged', async () => {
    const [table] = (await reader.read(testEnvelope(prefixed, 'dialect.xlsx'))).tables;

    DIALECT_FIXTURE_CELLS.forEach((expectedRow, rowIndex) => {
      const row = table.rows.find((r) => r.number === rowIndex + 1)!;
      expect(row).toBeDefined();
      expectedRow.forEach((expectedValue, columnIndex) => {
        expect(textAt(row, columnIndex + 1)).toBe(expectedValue);
      });
    });
  });

  it('the ORIGINAL bytes are never mutated — normalization works on a copy', async () => {
    const before = Buffer.from(prefixed);
    await reader.read(testEnvelope(prefixed, 'dialect.xlsx'));
    // LAW B: what SIMPROK archives and hashes is the artifact as it arrived.
    expect(prefixed.equals(before)).toBe(true);
  });

  it('an ordinary workbook is NOT normalized — the happy path is untouched', async () => {
    const read = await reader.read(testEnvelope(plain, 'plain.xlsx'));
    expect(read.readerDiagnostics ?? []).not.toContain(
      XLSX_READER_DIAGNOSTICS.OOXML_DIALECT_NORMALIZED,
    );
    const [table] = read.tables;
    expect(textAt(table.rows.find((r) => r.number === 2)!, 1)).toBe('alpha');
  });

  it('a genuinely unreadable file still fails closed, and blames no one', async () => {
    await expect(
      reader.read(testEnvelope(Buffer.from('not a workbook at all'), 'broken.xlsx')),
    ).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE' });
  });
});

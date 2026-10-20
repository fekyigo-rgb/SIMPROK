import ExcelJS from 'exceljs';
import { buildPortableBoqXlsx } from '../../test/fixtures/boq-xlsx.fixture';
import { BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';

describe('BoqXlsxIntakeAdapter', () => {
  const adapter = new BoqXlsxIntakeAdapter();

  it('parses a portable hierarchy and excludes totals and source prices', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx(), 'portable.xlsx', 'RAB');
    expect(result.rows.map((row) => row.itemType)).toEqual(['FOLDER', 'WORK_ITEM', 'FOLDER', 'WORK_ITEM']);
    expect(result.rows[1]).toMatchObject({ description: 'Mobilisasi', quantityDecimalString: '1', unitRaw: 'LS', parentSourceReference: 'row:3' });
    expect(result.rows.some((row) => /total|profit|ppn/i.test(row.description))).toBe(false);
    expect(JSON.stringify(result.rows)).not.toContain('125000');
  });

  it('counts all fifteen scale violations but caps examples at ten', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ scaleViolations: 15 }), 'scale.xlsx', 'RAB');
    expect(result.sourceQuantityEvidence.rowsExceedingScale2).toBe(15);
    expect(result.sourceQuantityEvidence.examples).toHaveLength(10);
  });

  it('marks an invalid work-item quantity as a hard error', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ includeInvalid: true }), 'invalid.xlsx', 'RAB');
    expect(result.rows.find((row) => row.description === 'Item quantity invalid')?.errors).toContain('INVALID_QUANTITY');
  });

  it('marks a work item without a unit as a hard error', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ includeMissingUnit: true }), 'missing-unit.xlsx', 'RAB');
    expect(result.rows.find((row) => row.description === 'Item unit missing')?.errors).toContain('UNIT_REQUIRED');
  });
});

describe('BOQ header-based intake regression', () => {
  async function workbookBytes(options: { secondBoq?: boolean; duplicateVolume?: boolean; guide?: boolean; shifted?: boolean } = {}) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('RAB 1');
    const offset = options.shifted ? 2 : 0;
    const set = (row: number, col: number, value: string) => { sheet.getCell(row, col + offset).value = value; };
    set(3, 1, 'No'); set(3, 2, 'Uraian'); set(3, 5, 'Volume'); set(3, 6, 'Satuan');
    sheet.mergeCells(3, 2 + offset, 3, 4 + offset);
    if (options.duplicateVolume) set(3, 7, 'Volume');
    if (options.guide) {
      set(4, 1, '1'); set(4, 2, '2'); set(4, 5, '3'); set(4, 6, '4');
    }
    const row = options.guide ? 5 : 4;
    set(row, 1, '1'); set(row, 2, 'Saluran U Pracetak DS10A'); set(row, 5, '1.25'); set(row, 6, 'm');
    book.addWorksheet('Catatan').getCell('A1').value = 'Dokumen pendukung';
    if (options.secondBoq) {
      const second = book.addWorksheet('BOQ lain');
      second.addRow(['No', 'Uraian Pekerjaan', 'Volume', 'Satuan']);
      second.addRow(['1', 'Lainnya', '3', 'm2']);
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  it.each([false, true])('maps swapped columns and preserves first work row (guide=%s)', async (guide) => {
    const r = await new BoqXlsxIntakeAdapter().parse(await workbookBytes({ guide }), 'owner-shape.xlsx');
    expect(r.sheetName).toBe('RAB 1');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ description: 'Saluran U Pracetak DS10A', quantityDecimalString: '1.25', unitRaw: 'm', errors: [] });
  });
  it('uses header positions when the table is shifted', async () => {
    const r = await new BoqXlsxIntakeAdapter().parse(await workbookBytes({ shifted: true }), 'shifted.xlsx');
    expect(r.rows[0]).toMatchObject({ sourceCode: '1', quantityDecimalString: '1.25', unitRaw: 'm' });
  });
  it('rejects ambiguous sheets but honors explicit selection', async () => {
    const bytes = await workbookBytes({ secondBoq: true });
    const adapter = new BoqXlsxIntakeAdapter();
    await expect(adapter.parse(bytes, 'ambiguous.xlsx')).rejects.toThrow('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');
    expect((await adapter.parse(bytes, 'ambiguous.xlsx', 'RAB 1')).sheetName).toBe('RAB 1');
    await expect(adapter.parse(bytes, 'ambiguous.xlsx', 'missing')).rejects.toThrow('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');
  });
  it('rejects duplicate volume headers instead of guessing', async () => {
    await expect(new BoqXlsxIntakeAdapter().parse(await workbookBytes({ duplicateVolume: true }), 'duplicate.xlsx')).rejects.toThrow('BOQ_HEADER_AMBIGUOUS');
  });
});

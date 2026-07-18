import { readFile } from 'fs/promises';
import { BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';

describe('BoqXlsxIntakeAdapter', () => {
  it('parses the real Owner BOQ without importing summaries, prices, or floating quantity casts', async () => {
    const bytes = await readFile('C:/SIMPROK/data/first-real-input/BOQ(1).xlsx');
    const result = await new BoqXlsxIntakeAdapter().parse(bytes, 'BOQ(1).xlsx', 'RAB');

    expect(result.sourceSha256).toBe('0DD1280CF11FD1994DA90CE86B7E64C19F3E047F251BBDAC40987D2877FE3263');
    expect(result.sheetName).toBe('RAB');
    expect(result.totalSourceRows).toBe(84);
    expect(result.sourceQuantityEvidence).toMatchObject({ maxScale: 0, rowsExceedingScale2: 0 });
    expect(result.rows).toHaveLength(74);
    expect(result.rows.filter((row) => row.itemType === 'FOLDER')).toHaveLength(16);
    expect(result.rows.filter((row) => row.itemType === 'WORK_ITEM')).toHaveLength(58);
    expect(result.rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(result.rows.some((row) => /^(jumlah|subtotal|total|profit|ppn|terbilang)/i.test(row.description))).toBe(false);
    expect(result.rows.find((row) => row.sourceRowNumber === 15)).toMatchObject({
      description: 'Mobilisasi dan Demobilisasi', quantityDecimalString: '1', unitRaw: 'LS', itemType: 'WORK_ITEM',
    });
  });

  it('rejects ambiguous sheet selection and malformed workbooks', async () => {
    await expect(new BoqXlsxIntakeAdapter().parse(Buffer.from('not-xlsx'), 'bad.xlsx', 'RAB')).rejects.toBeDefined();
  });
});

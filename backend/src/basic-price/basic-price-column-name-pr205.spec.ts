import ExcelJS from 'exceljs';
import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { matchHeaderRole } from '../universal-intake/structure/header-vocabulary';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

const adapter = new BasicPriceUniversalIntakeAdapter();

async function importXlsx(
  headers: string[],
  values: Array<Array<string | number>>,
) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('DAFTAR HARGA BAHAN');
  sheet.addRow(headers);
  for (const row of values) sheet.addRow(row);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  return adapter.parse(testEnvelope(bytes, 'pr205-column-proof.xlsx'), {
    declaredSection: 'MATERIAL',
  });
}

describe('PR205 browser-proof: qualified resource heading outranks ambiguous Jenis', () => {
  it('reads the exact five-column failing browser fixture, preserving every source field', async () => {
    const result = await importXlsx(
      ['Kode', 'Uraian Bahan', 'Satuan', 'Harga Satuan', 'Jenis'],
      [
        ['TEST-M-01', 'Kayu 5/7 cm', 'Batang', 35000, 'BAHAN'],
        ['TEST-M-02', 'Kayu 5/10 cm', 'Batang', 49000, 'BAHAN'],
        ['TEST-M-03', 'Kayu', 'Batang', 31000, 'BAHAN'],
        ['TEST-M-04', 'Rubber Ring Dia. 100 cm', 'Unit', 292800, 'BAHAN'],
      ],
    );
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((r) => r.rawResourceNameText)).toEqual([
      'Kayu 5/7 cm',
      'Kayu 5/10 cm',
      'Kayu',
      'Rubber Ring Dia. 100 cm',
    ]);
    for (let i = 0; i < result.rows.length; i += 1) {
      const row = result.rows[i];
      expect(row.sourceNameCellAddress).toBe('B' + (i + 2));
      expect(row.sourceCodeCellAddress).toBe('A' + (i + 2));
      expect(row.sourceUnitCellAddress).toBe('C' + (i + 2));
      expect(row.sourcePriceCellAddress).toBe('D' + (i + 2));
      expect(row.sourceSection).toBe('MATERIAL');
      expect(row.rawSourceContext).toMatchObject({ Jenis: 'BAHAN' });
      expect(row.errors).toEqual([]);
    }
  });

  it('keeps unqualified Jenis as source context alongside unambiguous Uraian', async () => {
    const result = await importXlsx(
      ['Kode', 'Uraian', 'Satuan', 'Harga', 'Jenis'],
      [['TEST-M-01', 'Balok kayu', 'm3', 110000, 'Bangkirai']],
    );
    expect(result.rows[0].rawResourceNameText).toBe('Balok kayu');
    expect(result.rows[0].sourceNameCellAddress).toBe('B2');
    expect(result.rows[0].rawSourceContext).toMatchObject({
      Jenis: 'Bangkirai',
    });
  });

  it('preserves the prior legacy header behavior when Jenis is the ONLY name header', async () => {
    expect(matchHeaderRole('Jenis')).toBe('RESOURCE_NAME');
    expect(matchHeaderRole('Uraian Bahan')).toBe('RESOURCE_NAME');
    const result = await importXlsx(
      ['Kode', 'Jenis', 'Satuan', 'Harga'],
      [['TEST-M-01', 'Semen Portland', 'Sak', 75000]],
    );
    expect(result.rows[0].rawResourceNameText).toBe('Semen Portland');
    expect(result.rows[0].sourceNameCellAddress).toBe('B2');
  });
});

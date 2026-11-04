import ExcelJS from 'exceljs';
import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';
import { sourceKeteranganEvidence, sourceSpecificationEvidence } from './basic-price-source-specification-gate';

/**
 * Owner source layout: A-E price, F-O specification with 3-tier headers,
 * P additional supplier text, Q explanatory notes. No extra importer.
 */
describe('Owner multi-level Basic Price workbook — isolated intake proof', () => {
  it('retains the specification child labels and every source fact in a priced row', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    for (const [address, value] of Object.entries({
      A4: 'No.', B4: 'Uraian', C4: 'Kode', D4: 'Satuan', E4: 'Harga Satuan',
      F4: 'Spesifikasi', P4: 'Spesifikasi Tambahan', Q4: 'Keterangan',
      F5: 'KDN', G5: 'Merk', H5: 'Tipe/Model', I5: 'Ukuran', O5: 'Warna',
      I6: 'Panjang', J6: 'lebar', K6: 'tinggi', L6: 'diameter',
      M6: 'volume', N6: 'Berat',
    })) sheet.getCell(address).value = value;
    sheet.mergeCells('A4:A6'); sheet.mergeCells('B4:B6');
    sheet.mergeCells('C4:C6'); sheet.mergeCells('D4:D6');
    sheet.mergeCells('E4:E6'); sheet.mergeCells('F4:O4');
    sheet.mergeCells('G5:G6'); sheet.mergeCells('H5:H6');
    sheet.mergeCells('I5:N5'); sheet.mergeCells('O5:O6');
    sheet.mergeCells('P4:P6'); sheet.mergeCells('Q4:Q6');
    sheet.getCell('B8').value = 'Semen Conch 50 kg';
    sheet.getCell('C8').value = 'M12.c';
    sheet.getCell('D8').value = 'zak';
    sheet.getCell('E8').value = 63000;
    sheet.getCell('F8').value = 65.5;
    sheet.getCell('G8').value = 'Conch';
    sheet.getCell('N8').value = '50 kg';
    sheet.getCell('Q8').value = 'Semen Portland';
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const knowledge = await new BasicPriceUniversalIntakeAdapter().parse(
      testEnvelope(bytes, 'owner-hierarchical-price.xlsx'),
      { declaredSection: 'MATERIAL' },
    );
    expect(knowledge.parserContractVersion).toBe('USI01_BASIC_PRICE_SEMANTIC_SPEC_CHILD_V1');
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    expect(knowledge.rows).toHaveLength(1);
    const row = knowledge.rows[0];
    expect(row.rawResourceNameText).toBe('Semen Conch 50 kg');
    expect(row.rawUnitText).toBe('zak');
    expect(row.proposedCanonicalPrice).toBe('63000.00');
    expect(row.proposedCanonicalKdn).toBe('65.50');
    expect(sourceKeteranganEvidence(row.rawSourceContext)).toBe('Semen Portland');
    expect(sourceSpecificationEvidence(row.rawSourceContext)).toEqual(
      expect.arrayContaining([
        { label: 'Merk', value: 'Conch' },
        { label: 'Berat', value: '50 kg' },
      ]),
    );
  });
});

import ExcelJS from 'exceljs';

export interface BasicPriceFixtureOptions {
  includeMissingUnit?: boolean;
  includeMissingPrice?: boolean;
  includeFormulaError?: boolean;
  includeFormulaCachedResult?: boolean;
  includeExactTieRounding?: boolean;
  includeLongRoundTripDecimal?: boolean;
}

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

/**
 * Builds an in-memory workbook mirroring the real, reconfirmed source
 * structure (data/first-real-input/BASIC PRICE(1).xlsx, single sheet,
 * three sections each introduced by a full-row title and a "NO"
 * column-header row, sharing one column layout: B=no, C=name, D=code,
 * E=unit, F=price). Parametrized for the specific edge cases the RM-02
 * test matrix requires -- never a copy of real business data.
 */
export async function buildBasicPriceXlsx(options: BasicPriceFixtureOptions = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('HARGA SATUAN UPAH DAN BAHAN');

  // --- LABOR section ---
  sheet.getCell('B5').value = 'DAFTAR HARGA SATUAN UPAH';
  sheet.getCell('B7').value = 'NO';
  sheet.getCell('C7').value = 'TENAGA KERJA';
  sheet.getCell('D7').value = 'SATUAN';
  sheet.getCell('E7').value = 'SATUAN';
  sheet.getCell('F7').value = 'HARGA  (Rp)';
  sheet.getCell('G7').value = 'KET';

  sheet.getCell('B9').value = '1';
  sheet.getCell('C9').value = 'Pekerja';
  sheet.getCell('D9').value = 'L.01';
  sheet.getCell('E9').value = 'Org/Hari';
  const priceCell = sheet.getCell('F9');
  priceCell.value = options.includeLongRoundTripDecimal ? 158333.33333333334 : 100000;
  priceCell.numFmt = CURRENCY_NUMFMT;
  if (options.includeFormulaError) {
    sheet.getCell('G9').value = { formula: '#REF!/160', result: { error: '#REF!' } } as any;
  }

  if (options.includeExactTieRounding) {
    sheet.getCell('B10').value = '2';
    sheet.getCell('C10').value = 'Tukang (exact-tie)';
    sheet.getCell('D10').value = 'L.02';
    sheet.getCell('E10').value = 'Org/Hari';
    sheet.getCell('F10').value = 0.125;
  }

  if (options.includeFormulaCachedResult) {
    sheet.getCell('B11').value = '3';
    sheet.getCell('C11').value = 'Mandor (formula price)';
    sheet.getCell('D11').value = 'L.04';
    sheet.getCell('E11').value = 'Org/Hari';
    sheet.getCell('F11').value = { formula: 'F9*1.5', result: 150000 } as any;
  }

  // --- MATERIAL section ---
  sheet.getCell('B28').value = 'DAFTAR HARGA SATUAN BAHAN';
  sheet.getCell('B30').value = 'NO';
  sheet.getCell('C30').value = 'BAHAN';
  sheet.getCell('D30').value = 'SATUAN';
  sheet.getCell('E30').value = 'SATUAN';
  sheet.getCell('F30').value = 'HARGA  (Rp)';
  sheet.getCell('G30').value = 'KET';

  sheet.getCell('C33').value = { formula: '[1]ANALISA!C94', result: 'Kawat jaring' } as any;
  sheet.getCell('D33').value = '01 K';
  sheet.getCell('E33').value = { formula: '[1]ANALISA!E94', result: 'Lbr' } as any;
  sheet.getCell('F33').value = 1100000;
  sheet.getCell('F33').numFmt = CURRENCY_NUMFMT;

  if (options.includeMissingUnit) {
    sheet.getCell('C39').value = 'Kawat BRC (missing unit and price)';
    // D39/E39/F39 intentionally left empty.
  }

  if (options.includeMissingPrice) {
    sheet.getCell('C40').value = 'Balok kayu (missing price only)';
    sheet.getCell('D40').value = 'M.10';
    sheet.getCell('E40').value = 'M3';
    // F40 intentionally left empty.
  }

  // --- EQUIPMENT section ---
  sheet.getCell('B312').value = 'DAFTAR HARGA SEWA PERALATAN';
  sheet.getCell('B314').value = 'NO';
  sheet.getCell('C314').value = 'PERALATAN';
  sheet.getCell('D314').value = 'SATUAN';
  sheet.getCell('E314').value = 'SATUAN';
  sheet.getCell('F314').value = 'HARGA  (Rp)';
  sheet.getCell('G314').value = 'KET.';

  sheet.getCell('B316').value = '1';
  sheet.getCell('C316').value = 'Sewa crane';
  sheet.getCell('D316').value = 'E.12.a';
  sheet.getCell('E316').value = 'U/J';
  sheet.getCell('F316').value = 1714285.7142857143;
  sheet.getCell('F316').numFmt = CURRENCY_NUMFMT;

  // Trailing summary cells (not resource rows) mirroring the real
  // workbook's trailer -- must never become a parsed row (no name).
  sheet.getCell('G331').value = 1866079000;
  sheet.getCell('G333').value = 2332600000;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

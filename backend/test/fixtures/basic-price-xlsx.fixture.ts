import ExcelJS from 'exceljs';

export interface BasicPriceFixtureOptions {
  includeMissingUnit?: boolean;
  includeMissingPrice?: boolean;
  includeFormulaError?: boolean;
  includeFormulaCachedResult?: boolean;
  includeExactTieRounding?: boolean;
  includeLongRoundTripDecimal?: boolean;
  /** RM-03D1 — MATERIAL rows the Reviewed Resource Admission matrix needs. */
  includeAdmissionRows?: boolean;
  /**
   * B1B12 zero-provenance matrix. A price of zero and a price that could not
   * be read are different facts, and the three rows below are the shapes that
   * could plausibly be confused for one another:
   *
   *   includeZeroPrice                 a real, stated 0 — a PRICE
   *   includeTextPrice                 unreadable text  — NOT a price
   *   includeFormulaWithoutCachedResult  a formula whose value was never
   *                                    cached — NOT a price
   */
  includeZeroPrice?: boolean;
  includeTextPrice?: boolean;
  includeFormulaWithoutCachedResult?: boolean;
}

/**
 * RM-03D1 — the MATERIAL rows the admission acceptance matrix drives, kept
 * here so the spec asserts against names it did not also invent inline.
 *
 * Each one exists to prove a different refusal or the single permission:
 * genuinely unknown, known under a different spelling, known globally, already
 * bound to another resource's provenance, and a same-name pair that two
 * concurrent requests race for.
 */
export const ADMISSION_ROWS = {
  UNKNOWN: { row: 41, name: 'Sirtu Admisi', unit: 'M3', price: 133800 },
  DIFFERENT_SPELLING: { row: 42, name: 'Semen Portland', unit: 'M3', price: 1500000 },
  GLOBAL_KNOWN: { row: 43, name: 'Batu Kali Kanonik Global', unit: 'M3', price: 250000 },
  ROLLBACK: { row: 44, name: 'Pasir Rollback', unit: 'M3', price: 310000 },
  CONCURRENT_A: { row: 45, name: 'Kerikil Konkuren', unit: 'M3', price: 410000 },
  CONCURRENT_B: { row: 46, name: 'Kerikil Konkuren', unit: 'M3', price: 420000 },
  // The harder race: two SPELLINGS, one plausible identity. Row 42 supplies
  // "Semen Portland"; this is the other half of that pair.
  CONCURRENT_SPELLING: { row: 47, name: 'Semen Portlan', unit: 'M3', price: 1400000 },
} as const;

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

  // A REAL, STATED ZERO. The cell is genuinely numeric and its value is 0 —
  // the same shape every AHSP "Alat Bantu" line has. This is a price.
  if (options.includeZeroPrice) {
    sheet.getCell('C41').value = 'Alat Bantu (stated zero price)';
    sheet.getCell('D41').value = 'M.11';
    sheet.getCell('E41').value = 'Ls';
    sheet.getCell('F41').value = 0;
    sheet.getCell('F41').numFmt = CURRENCY_NUMFMT;
  }

  // TEXT WHERE A NUMBER BELONGS. A human wrote a dash. It is not zero, not a
  // price, and must never be read as one.
  if (options.includeTextPrice) {
    sheet.getCell('C42').value = 'Pasir (price written as text)';
    sheet.getCell('D42').value = 'M.12';
    sheet.getCell('E42').value = 'M3';
    sheet.getCell('F42').value = 'Rp. -';
  }

  // A FORMULA WHOSE RESULT WAS NEVER CACHED. The workbook states how the
  // number would be computed but not what it is; SIMPROK does not evaluate
  // spreadsheets, so there is no value here to read.
  if (options.includeFormulaWithoutCachedResult) {
    sheet.getCell('C43').value = 'Semen (uncached formula price)';
    sheet.getCell('D43').value = 'M.13';
    sheet.getCell('E43').value = 'Zak';
    sheet.getCell('F43').value = { formula: 'F33*2' } as any;
  }

  if (options.includeAdmissionRows) {
    for (const entry of Object.values(ADMISSION_ROWS)) {
      sheet.getCell(`C${entry.row}`).value = entry.name;
      // No code cell: these rows carry no source code, so admission must
      // store null rather than borrow one.
      sheet.getCell(`E${entry.row}`).value = entry.unit;
      sheet.getCell(`F${entry.row}`).value = entry.price;
      sheet.getCell(`F${entry.row}`).numFmt = CURRENCY_NUMFMT;
    }
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
  // "U/J" — unit/jam, how this document actually spells an equipment rental
  // hour. It stays exactly as written: source evidence is never rewritten to
  // suit the machine. The Unit Kernel is what learns to read it, and only
  // inside EQUIPMENT context.
  sheet.getCell('E316').value = 'U/J';
  sheet.getCell('F316').value = 1714285.7142857143;
  sheet.getCell('F316').numFmt = CURRENCY_NUMFMT;

  // Trailing summary cells (not resource rows) mirroring the real
  // workbook's trailer -- must never become a parsed row (no name).
  sheet.getCell('G331').value = 1866079000;
  sheet.getCell('G333').value = 2332600000;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

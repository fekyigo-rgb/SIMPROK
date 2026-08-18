import ExcelJS from 'exceljs';

/**
 * USI-01 acceptance fixtures.
 *
 * These reproduce the SHAPES the Owner's two acceptance workbooks are
 * described as having — a SIMPROK-ready semantic header table, and a
 * three-jurisdiction regional matrix — plus the delimited-text and adversarial
 * shapes the §19 matrix requires.
 *
 * They are SHAPES, never copies of real business data: every resource name and
 * every figure here is invented. The real workbooks are not present in this
 * repository, and inventing their contents to claim a rehearsal would be
 * precisely the fabricated evidence this project forbids.
 */

/**
 * The three heavy-plant resources the Owner's real IKK workbook is known to
 * carry under category_name = ALAT. Names match the real source so the proof
 * reads the same whether it runs against this fixture or the real file.
 */
export const EQUIPMENT_ROWS = [
  { name: 'Buldozer', unit: 'Jam', price: 850000 },
  { name: 'Excavator', unit: 'Jam', price: 795000 },
  { name: 'Genset', unit: 'Jam', price: 210000 },
] as const;

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

export interface SemanticHeaderFixtureOptions {
  /**
   * USI-01R GAP B — reproduce the real IKK workbook's PER-ROW CATEGORY columns
   * (`category_code` / `category_name`), including its ALAT equipment rows.
   * Without this the table looks homogeneous and a blanket declaration seems
   * harmless; with it, a global MATERIAL declaration would file a bulldozer as
   * a building material.
   */
  includeRowCategories?: boolean;
  /** A row whose stated category SIMPROK has no safe mapping for (CAT-07). */
  includeUnmappableCategory?: boolean;
  /** Extra worksheets, to prove no first-sheet fallback and no name dependency. */
  extraEmptySheetNames?: string[];
  /** A second, competing price table in another sheet — forces a human choice. */
  includeSecondPriceSheet?: boolean;
  /** A row whose price cell holds text, not a number. */
  includeTextPriceRow?: boolean;
  /** Sheet name, to prove detection never depends on it. */
  sheetName?: string;
}

/**
 * WORKBOOK A SHAPE — "SIMPROK READY": a single header row of semantic column
 * names, one price column, and provenance columns the domain has no field for.
 *
 * The header row is deliberately NOT row 1: a real prepared workbook carries a
 * title block above its table, and detection has to find the header by evidence
 * rather than by position.
 */
export async function buildSemanticHeaderXlsx(
  options: SemanticHeaderFixtureOptions = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName ?? 'Sheet1');

  sheet.getCell('A1').value = 'BASIC PRICE IKK — SIMPROK READY (SHAPE FIXTURE)';
  sheet.getCell('A2').value = 'Disusun untuk uji struktur, bukan data nyata';

  sheet.getCell('A4').value = 'resource_name';
  sheet.getCell('B4').value = 'source_unit';
  sheet.getCell('C4').value = 'simprok_unit_candidate';
  sheet.getCell('D4').value = 'selected_price_2024';
  sheet.getCell('E4').value = 'sumber';
  sheet.getCell('F4').value = 'keterangan';
  if (options.includeRowCategories) {
    sheet.getCell('G4').value = 'category_code';
    sheet.getCell('H4').value = 'category_name';
  }

  const rows: Array<[string, string, string, number, string, string]> = [
    ['Pasir Uji Struktur', 'M3', 'm3', 398000, 'Survei Uji', 'baris bersih'],
    ['Batu Uji Struktur', 'M3', 'm3', 344000, 'Survei Uji', 'baris bersih'],
    ['Semen Uji Struktur', 'Zak', 'zak', 68500, 'Survei Uji', 'baris bersih'],
    ['Besi Uji Struktur', 'Kg', 'kg', 17250.555, 'Survei Uji', 'pembulatan'],
  ];
  rows.forEach(([name, unit, candidate, price, source, note], index) => {
    const rowNumber = 5 + index;
    sheet.getCell(`A${rowNumber}`).value = name;
    sheet.getCell(`B${rowNumber}`).value = unit;
    sheet.getCell(`C${rowNumber}`).value = candidate;
    const priceCell = sheet.getCell(`D${rowNumber}`);
    priceCell.value = price;
    priceCell.numFmt = CURRENCY_NUMFMT;
    sheet.getCell(`E${rowNumber}`).value = source;
    sheet.getCell(`F${rowNumber}`).value = note;
    if (options.includeRowCategories) {
      // Every seeded row above is genuinely a material, and says so.
      sheet.getCell(`G${rowNumber}`).value = 'B';
      sheet.getCell(`H${rowNumber}`).value = 'BAHAN';
    }
  });

  // THE ROWS THAT MAKE GAP B REAL. In the Owner's actual IKK workbook these
  // carry category_name = ALAT, and they are heavy plant, not materials.
  if (options.includeRowCategories) {
    EQUIPMENT_ROWS.forEach(({ name, unit, price }, index) => {
      const rowNumber = 10 + index;
      sheet.getCell(`A${rowNumber}`).value = name;
      sheet.getCell(`B${rowNumber}`).value = unit;
      sheet.getCell(`C${rowNumber}`).value = unit.toLowerCase();
      const priceCell = sheet.getCell(`D${rowNumber}`);
      priceCell.value = price;
      priceCell.numFmt = CURRENCY_NUMFMT;
      sheet.getCell(`E${rowNumber}`).value = 'Survei Uji';
      sheet.getCell(`G${rowNumber}`).value = 'F';
      sheet.getCell(`H${rowNumber}`).value = 'ALAT';
    });

    // A labour row, so the third family is proven too.
    sheet.getCell('A14').value = 'Pekerja Uji Struktur';
    sheet.getCell('B14').value = 'OH';
    sheet.getCell('D14').value = 125000;
    sheet.getCell('G14').value = 'A';
    sheet.getCell('H14').value = 'TENAGA KERJA';
  }

  if (options.includeUnmappableCategory) {
    sheet.getCell('A15').value = 'Sumber Daya Tak Dikenal';
    sheet.getCell('B15').value = 'Ls';
    sheet.getCell('D15').value = 99000;
    sheet.getCell('G15').value = 'Z';
    // A category the source states plainly and SIMPROK has never met.
    sheet.getCell('H15').value = 'JASA PIHAK KETIGA';
  }

  if (options.includeTextPriceRow) {
    sheet.getCell('A9').value = 'Kayu Uji Struktur';
    sheet.getCell('B9').value = 'M3';
    sheet.getCell('C9').value = 'm3';
    sheet.getCell('D9').value = 'Rp. -';
    sheet.getCell('E9').value = 'Survei Uji';
  }

  for (const name of options.extraEmptySheetNames ?? []) {
    const extra = workbook.addWorksheet(name);
    extra.getCell('A1').value = 'Catatan bebas';
    extra.getCell('A2').value = 'Tidak ada tabel harga di lembar ini';
  }

  if (options.includeSecondPriceSheet) {
    const second = workbook.addWorksheet('Lembar Kedua');
    second.getCell('A1').value = 'resource_name';
    second.getCell('B1').value = 'satuan';
    second.getCell('C1').value = 'harga satuan';
    second.getCell('A2').value = 'Kerikil Uji Struktur';
    second.getCell('B2').value = 'M3';
    second.getCell('C2').value = 275000;
    second.getCell('A3').value = 'Sirtu Uji Struktur';
    second.getCell('B3').value = 'M3';
    second.getCell('C3').value = 133800;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const REGION_COLUMN_LABELS = ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'] as const;

export interface RegionalMatrixFixtureOptions {
  /** A row where one jurisdiction is priced and the others are blank. */
  includePartiallyPricedRow?: boolean;
  sheetName?: string;
}

/**
 * WORKBOOK B SHAPE — a regional matrix: one resource per row, one PRICE COLUMN
 * PER JURISDICTION.
 *
 * The three jurisdiction headers carry no price-role word at all, which is
 * exactly what makes them detectable as parallel numeric columns rather than as
 * "the price column". SIMPROK never maps these labels to canonical Regions —
 * that stays a human decision.
 */
export async function buildRegionalMatrixXlsx(
  options: RegionalMatrixFixtureOptions = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName ?? 'Harga');

  sheet.getCell('A1').value = 'DAFTAR HARGA PER WILAYAH (SHAPE FIXTURE)';

  sheet.getCell('A3').value = 'URAIAN';
  sheet.getCell('B3').value = 'SATUAN';
  sheet.getCell('C3').value = REGION_COLUMN_LABELS[0];
  sheet.getCell('D3').value = REGION_COLUMN_LABELS[1];
  sheet.getCell('E3').value = REGION_COLUMN_LABELS[2];

  const rows: Array<[string, string, number, number, number]> = [
    ['Batu Belah Uji', 'M3', 398000, 344000, 314000],
    ['Pasir Pasang Uji', 'M3', 285000, 262500, 240000],
    ['Sirtu Uji', 'M3', 133800, 128000, 121500],
  ];
  rows.forEach(([name, unit, sirimau, teluk, baguala], index) => {
    const rowNumber = 4 + index;
    sheet.getCell(`A${rowNumber}`).value = name;
    sheet.getCell(`B${rowNumber}`).value = unit;
    for (const [offset, value] of [sirimau, teluk, baguala].entries()) {
      const cell = sheet.getCell(rowNumber, 3 + offset);
      cell.value = value;
      cell.numFmt = CURRENCY_NUMFMT;
    }
  });

  if (options.includePartiallyPricedRow) {
    sheet.getCell('A7').value = 'Kerikil Uji Sebagian';
    sheet.getCell('B7').value = 'M3';
    sheet.getCell('C7').value = 410000;
    // D7 and E7 intentionally left empty: this resource is priced in one
    // jurisdiction only, and the other two must not inherit its number.
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A clean, semantically-headed Basic Price CSV. */
export function buildBasicPriceCsv(): Buffer {
  return Buffer.from(
    [
      'resource_name,source_unit,harga satuan,sumber',
      'Pasir Uji CSV,M3,398000,Survei Uji',
      '"Batu Belah, Uji CSV",M3,344000,Survei Uji',
      'Semen Uji CSV,Zak,68500,Survei Uji',
      '',
    ].join('\r\n'),
    'utf8',
  );
}

export interface AdversarialCsvOptions {
  /** UTF-8 BOM, as Excel writes it. */
  withBom?: boolean;
  /** Semicolon-delimited, as much of Europe writes it. */
  semicolonDelimited?: boolean;
}

/**
 * The awkward CSV: quoted commas, non-ASCII names, both numeric locales, an
 * undecidable literal, a currency-annotated literal, and a missing unit.
 */
export function buildAdversarialCsv(options: AdversarialCsvOptions = {}): Buffer {
  const delimiter = options.semicolonDelimited ? ';' : ',';
  const line = (fields: string[]) => fields.join(delimiter);
  const body = [
    line(['resource_name', 'source_unit', 'harga satuan', 'keterangan']),
    // A quoted field containing the delimiter itself.
    line([`"Batu Belah, Nomor 2"`, 'M3', '344000', 'koma dalam kutip']),
    // Non-ASCII must survive byte-for-byte.
    line(['Semen Grésik Ünicode', 'Zak', '68500', 'utf8']),
    // Indonesian convention: dot groups, comma decimal. Deterministic.
    line(['Besi Beton Uji', 'Kg', '"17.250,55"', 'locale id']),
    // Anglo convention: comma groups, dot decimal. Also deterministic.
    line(['Kayu Balok Uji', 'M3', '"1,250.50"', 'locale en']),
    // GENUINELY UNDECIDABLE: 125000 or 125.0? SIMPROK must refuse.
    line(['Cat Tembok Uji', 'Kaleng', '125.000', 'ambigu']),
    // A currency symbol: the domain models no currency, so this stays evidence.
    line(['Paku Uji', 'Kg', 'Rp 21500', 'mata uang']),
    // No unit at all.
    line(['Upah Uji Tanpa Satuan', '', '150000', 'satuan hilang']),
    '',
  ].join('\n');
  const text = options.withBom ? `﻿${body}` : body;
  return Buffer.from(text, 'utf8');
}

/** A CSV with a per-row Region column — §5's FLAT PRICE TABLE shape. */
export function buildFlatRegionColumnCsv(): Buffer {
  return Buffer.from(
    [
      'resource_name,source_unit,price,region',
      'Pasir Flat Uji,M3,398000,SIRIMAU',
      'Pasir Flat Uji,M3,344000,TELUK AMBON',
      'Batu Flat Uji,M3,285000,SIRIMAU',
      'Batu Flat Uji,M3,262500,BAGUALA',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** Readable text that is simply not a price table. */
export function buildNonPriceCsv(): Buffer {
  return Buffer.from(
    ['catatan rapat,tanggal', 'Bahas jadwal,2026-01-05', 'Bahas mutu,2026-01-12', ''].join(
      '\n',
    ),
    'utf8',
  );
}

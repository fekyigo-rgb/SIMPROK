import ExcelJS from 'exceljs';

/**
 * USI-01R3B §14 — THE TEXT-PRICE BOUNDARY, AS A WORKBOOK.
 *
 * One sheet whose price column holds every shape the boundary has to separate:
 * a native number, deterministic text, undecidable text, OCR-damaged text, a
 * blank, and formulas. Each row exists to pin exactly one rule, and the table
 * below is the single place that says which.
 *
 * These are SHAPES, not Owner data. Every resource name is invented. The
 * damaged literals ARE the real character sequences the Owner's Ambon workbook
 * contains — reproducing them is the whole point, because a fixture with
 * tidied-up damage would prove nothing about the file SIMPROK actually meets.
 */

/** How the price cell should be written, so the reader sees the intended type. */
export type PriceCellShape =
  | { kind: 'NUMBER'; value: number }
  | { kind: 'TEXT'; value: string }
  | { kind: 'RICH_TEXT'; value: string }
  | { kind: 'BLANK' }
  | { kind: 'FORMULA'; formula: string; result?: number | string };

export interface TextPriceCase {
  name: string;
  unit: string;
  price: PriceCellShape;
  /** The canonical price SIMPROK must propose, or null when it must refuse. */
  expectedCanonicalPrice: string | null;
  /** What this row is here to prove. */
  purpose: string;
}

/**
 * ONE ROW PER RULE.
 *
 * The four NUMERIC literals are real Ambon values whose meaning is not in
 * doubt: dot groups, comma decimal, well-formed. The refusals are the cases
 * where reading further would mean GUESSING what the document meant to say.
 */
export const TEXT_PRICE_CASES: readonly TextPriceCase[] = [
  {
    name: 'Native Number Uji',
    unit: 'M3',
    price: { kind: 'NUMBER', value: 250000 },
    expectedCanonicalPrice: '250000.00',
    purpose: 'TXT-01 — a workbook number is read from the workbook, untouched.',
  },
  {
    name: 'Native Rounding Uji',
    unit: 'Kg',
    price: { kind: 'NUMBER', value: 17250.555 },
    expectedCanonicalPrice: '17250.56',
    purpose: 'TXT-12 — native rounding (HALF_UP, 2dp) is unchanged.',
  },
  {
    name: 'Teks Deterministik Uji',
    unit: 'M3',
    price: { kind: 'TEXT', value: '153.000,00' },
    expectedCanonicalPrice: '153000.00',
    purpose: 'TXT-02 — a string with one numeric meaning normalizes.',
  },
  {
    name: 'Rich Text Deterministik Uji',
    unit: 'M2',
    price: { kind: 'RICH_TEXT', value: '153.000,00' },
    expectedCanonicalPrice: '153000.00',
    purpose: 'TXT-03 — rich text is still text, and reads the same.',
  },
  {
    name: 'Teks Desimal Uji',
    unit: 'Kg',
    price: { kind: 'TEXT', value: '17.250,50' },
    expectedCanonicalPrice: '17250.50',
    purpose: 'TXT-05 — a real decimal fraction survives normalization.',
  },
  {
    name: 'Teks Ambigu Uji',
    unit: 'Kaleng',
    price: { kind: 'TEXT', value: '125.000' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-06 — 125000 or 125.0? Undecidable, so SIMPROK refuses.',
  },
  {
    name: 'Teks Rusak T Uji',
    unit: 'Bh',
    price: { kind: 'RICH_TEXT', value: 'T73.000,00' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-07 — reading T as 1 would be CORRECTION, not normalization.',
  },
  {
    name: 'Teks Rusak O Uji',
    unit: 'Bh',
    price: { kind: 'RICH_TEXT', value: '3Ö10.000,00' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-08 — Ö is not 0. No OCR substitution exists.',
  },
  {
    name: 'Teks Rusak Huruf Uji',
    unit: 'Ls',
    price: { kind: 'RICH_TEXT', value: 's.ooo,oo' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-09 — letters where digits belong prove nothing.',
  },
  {
    name: 'Teks Rusak Ribuan Uji',
    unit: 'M3',
    price: { kind: 'RICH_TEXT', value: '314.ooo,oo' },
    expectedCanonicalPrice: null,
    purpose: 'A second real damaged literal, refused for the same reason.',
  },
  {
    name: 'Harga Kosong Uji',
    unit: 'Zak',
    price: { kind: 'BLANK' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-10 — an empty price cell states no price at all.',
  },
  {
    name: 'Formula Tanpa Hasil Uji',
    unit: 'M3',
    price: { kind: 'FORMULA', formula: 'D2*2' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-11 — SIMPROK never evaluates spreadsheets.',
  },
  {
    name: 'Formula Hasil Angka Uji',
    unit: 'M3',
    price: { kind: 'FORMULA', formula: 'D2*2', result: 500000 },
    expectedCanonicalPrice: '500000.00',
    purpose: 'TXT-11 — a cached NUMERIC result keeps its existing behaviour.',
  },
  {
    name: 'Formula Hasil Teks Uji',
    unit: 'M3',
    // A cached result that is TEXT stays refused: formula semantics are locked,
    // and R3B normalizes source text cells, never formula results.
    price: { kind: 'FORMULA', formula: 'D2&""', result: '153.000,00' },
    expectedCanonicalPrice: null,
    purpose: 'TXT-11 — formula behaviour is untouched, even for readable text.',
  },
];

export const TEXT_PRICE_HEADER_ROW = 1;
export const TEXT_PRICE_FIRST_DATA_ROW = 2;
/** 1-based price column, so tests can assert cell addresses against the source. */
export const TEXT_PRICE_COLUMN = 3;

/**
 * A minimal semantic-header table: resource_name / source_unit / harga satuan.
 *
 * Deliberately the SIMPLEST proven shape, so nothing about structure detection
 * is under test here — only what happens to the price cell.
 */
export async function buildTextPriceXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Harga Teks Uji');

  sheet.getCell('A1').value = 'resource_name';
  sheet.getCell('B1').value = 'source_unit';
  sheet.getCell('C1').value = 'harga satuan';

  TEXT_PRICE_CASES.forEach((testCase, index) => {
    const rowNumber = TEXT_PRICE_FIRST_DATA_ROW + index;
    sheet.getCell(rowNumber, 1).value = testCase.name;
    sheet.getCell(rowNumber, 2).value = testCase.unit;
    const cell = sheet.getCell(rowNumber, TEXT_PRICE_COLUMN);
    switch (testCase.price.kind) {
      case 'NUMBER':
        cell.value = testCase.price.value;
        break;
      case 'TEXT':
        cell.value = testCase.price.value;
        break;
      case 'RICH_TEXT':
        cell.value = { richText: [{ text: testCase.price.value }] };
        break;
      case 'BLANK':
        break; // written as nothing at all, so the reader sees a null cell
      case 'FORMULA':
        cell.value = {
          formula: testCase.price.formula,
          result: testCase.price.result,
        };
        break;
    }
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The row number a named case occupies, so a test never counts by hand. */
export function rowNumberOfCase(name: string): number {
  const index = TEXT_PRICE_CASES.findIndex(
    (testCase) => testCase.name === name,
  );
  if (index < 0) throw new Error(`unknown text-price case: ${name}`);
  return TEXT_PRICE_FIRST_DATA_ROW + index;
}

export const REGIONAL_TEXT_REGIONS = [
  'SIRIMAU',
  'TELUK AMBON',
  'BAGUALA',
] as const;
export type RegionalTextRegion = (typeof REGIONAL_TEXT_REGIONS)[number];

export const REGIONAL_TEXT_COLUMNS = {
  SIRIMAU: 4,
  'TELUK AMBON': 5,
  BAGUALA: 6,
} as const;

export const REGIONAL_TEXT_HEADER_ROW = 1;

/**
 * USI-01R3B §17 — NORMALIZATION MUST NOT REOPEN THE LEAKAGE DOOR.
 *
 * Text normalization gives a jurisdiction column a second way to produce a
 * number, which is exactly the kind of change that could quietly let one region
 * answer for another. So each row below mixes shapes ACROSS jurisdictions: a
 * deterministic string beside a native number beside OCR damage, so that any
 * borrowing would show up as a value that provably belongs to a neighbour.
 */
export const REGIONAL_TEXT_ROWS: ReadonlyArray<{
  rowNumber: number;
  code: string;
  name: string;
  unit: string;
  prices: Record<RegionalTextRegion, PriceCellShape>;
  expected: Record<RegionalTextRegion, string | null>;
  purpose: string;
}> = [
  {
    rowNumber: 2,
    code: 'P-01',
    name: 'Regional Teks A Uji',
    unit: 'M3',
    prices: {
      SIRIMAU: { kind: 'TEXT', value: '153.000,00' },
      'TELUK AMBON': { kind: 'NUMBER', value: 200000 },
      BAGUALA: { kind: 'RICH_TEXT', value: '314.ooo,oo' },
    },
    expected: {
      SIRIMAU: '153000.00',
      'TELUK AMBON': '200000.00',
      BAGUALA: null,
    },
    // The sharpest case: Sirimau normalizes, Baguala is damaged, and Baguala
    // must stay empty-handed rather than reaching one column left.
    purpose: 'normalized / native / damaged, side by side in one row.',
  },
  {
    rowNumber: 3,
    code: 'P-02',
    name: 'Regional Teks B Uji',
    unit: 'KG',
    prices: {
      SIRIMAU: { kind: 'NUMBER', value: 400000 },
      'TELUK AMBON': { kind: 'TEXT', value: '17.250,50' },
      BAGUALA: { kind: 'NUMBER', value: 420000 },
    },
    expected: {
      SIRIMAU: '400000.00',
      'TELUK AMBON': '17250.50',
      BAGUALA: '420000.00',
    },
    purpose: 'a normalized decimal between two native numbers.',
  },
  {
    rowNumber: 4,
    code: 'P-03',
    name: 'Regional Teks C Uji',
    unit: 'M2',
    prices: {
      SIRIMAU: { kind: 'TEXT', value: '372.000,00' },
      'TELUK AMBON': { kind: 'NUMBER', value: 300000 },
      BAGUALA: { kind: 'NUMBER', value: 310000 },
    },
    expected: {
      SIRIMAU: '372000.00',
      'TELUK AMBON': '300000.00',
      BAGUALA: '310000.00',
    },
    purpose: 'a second normalized value, to prove it is not a one-off.',
  },
  {
    rowNumber: 5,
    code: 'P-04',
    name: 'Regional Teks D Uji',
    unit: 'BH',
    prices: {
      SIRIMAU: { kind: 'NUMBER', value: 500000 },
      'TELUK AMBON': { kind: 'NUMBER', value: 510000 },
      BAGUALA: { kind: 'TEXT', value: '125.000' },
    },
    expected: {
      SIRIMAU: '500000.00',
      'TELUK AMBON': '510000.00',
      BAGUALA: null,
    },
    purpose: 'an UNDECIDABLE Baguala literal flanked by two clean numbers.',
  },
];

/** A three-jurisdiction matrix whose price columns mix numbers and text. */
export async function buildRegionalTextPriceXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Harga Wilayah Teks Uji');

  sheet.getCell('A1').value = 'KODE';
  sheet.getCell('B1').value = 'URAIAN';
  sheet.getCell('C1').value = 'SATUAN';
  REGIONAL_TEXT_REGIONS.forEach((region) => {
    sheet.getCell(
      REGIONAL_TEXT_HEADER_ROW,
      REGIONAL_TEXT_COLUMNS[region],
    ).value = region;
  });

  for (const row of REGIONAL_TEXT_ROWS) {
    sheet.getCell(row.rowNumber, 1).value = row.code;
    sheet.getCell(row.rowNumber, 2).value = row.name;
    sheet.getCell(row.rowNumber, 3).value = row.unit;
    for (const region of REGIONAL_TEXT_REGIONS) {
      const shape = row.prices[region];
      const cell = sheet.getCell(row.rowNumber, REGIONAL_TEXT_COLUMNS[region]);
      if (shape.kind === 'NUMBER') cell.value = shape.value;
      else if (shape.kind === 'TEXT') cell.value = shape.value;
      else if (shape.kind === 'RICH_TEXT')
        cell.value = { richText: [{ text: shape.value }] };
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

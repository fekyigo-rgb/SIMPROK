import ExcelJS from 'exceljs';

/**
 * A DOCUMENT WHOSE REAL UNIT COLUMN IS SPELLED IN WORDS SIMPROK HAS NEVER
 * LEARNED.
 *
 * WHY THIS EXISTS. A mirror once stood in `pruneDisprovenColumnCandidates` that
 * dropped a column from the UNIT options when the Unit Kernel resolved NOT ONE
 * of its values. Read as English that sounds careful. Read as logic it is the
 * invalid step: ABSENCE OF PROOF IS NOT PROOF OF ABSENCE. "I know none of these
 * spellings" is a fact about SIMPROK's dictionary, never a fact about the
 * document — and acting on it deleted the only true answer from the list, so a
 * person could no longer state what their own source plainly said.
 *
 * WHY A DECOY COLUMN IS THE POINT OF THIS FIXTURE. The pruning fails open when
 * filtering would empty a list, so a source whose ONLY unit-ish column is
 * unknown would have survived the defect by accident and proved nothing. This
 * document therefore states its units TWICE — once in its own local vocabulary
 * and once in vocabulary SIMPROK happens to know. The known column keeps the
 * filtered list non-empty, which is exactly what removed the unknown one, and
 * is the only shape in which the old behaviour is visible at all.
 *
 * NO OWNER DATA. Every figure is invented, every name says "Uji", and no cell
 * carries a header alias of any kind — not "No", not "Uraian", not "Satuan",
 * not "Harga" — because one of them would let the header-driven detector answer
 * the column question by itself and stop this fixture from reaching the
 * question it exists to reach.
 */

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

export const UNKNOWN_UNIT_REGIONS = [
  'SIRIMAU',
  'TELUK AMBON',
  'BAGUALA',
] as const;
export type UnknownUnitRegion = (typeof UNKNOWN_UNIT_REGIONS)[number];

/** 1-based source columns, stated once so tests assert against the SOURCE. */
export const UNKNOWN_UNIT_COLUMNS = {
  ROW_NUMBER: 1,
  NAME: 2,
  /** The document's OWN unit wording. SIMPROK knows none of it. */
  LOCAL_UNIT: 3,
  /** The same units restated in spellings SIMPROK does know. */
  KNOWN_UNIT: 4,
  SIRIMAU: 5,
  'TELUK AMBON': 6,
  BAGUALA: 7,
} as const;

export const UNKNOWN_UNIT_HEADER_ROW = 2;

/**
 * The local vocabulary, in the Owner's own example words. Nothing here is a
 * unit alias SIMPROK holds, and the tests assert that rather than assuming it.
 */
export const UNKNOWN_UNIT_LOCAL_VOCABULARY = [
  'sac',
  'bundle',
  'roll',
  'coil',
] as const;

/** Vocabulary a stubbed Unit Kernel answers RESOLVED for. */
export const UNKNOWN_UNIT_KNOWN_VOCABULARY = [
  'M3',
  'KG',
  'M2',
  'BUAH',
] as const;

export const UNKNOWN_UNIT_ROWS: ReadonlyArray<{
  rowNumber: number;
  itemNumber: number;
  name: string;
  localUnit: (typeof UNKNOWN_UNIT_LOCAL_VOCABULARY)[number];
  knownUnit: (typeof UNKNOWN_UNIT_KNOWN_VOCABULARY)[number];
  prices: Record<UnknownUnitRegion, number>;
}> = [
  {
    rowNumber: 3,
    itemNumber: 1,
    name: 'Semen Uji',
    localUnit: 'sac',
    knownUnit: 'KG',
    prices: { SIRIMAU: 100000, 'TELUK AMBON': 110000, BAGUALA: 120000 },
  },
  {
    rowNumber: 4,
    itemNumber: 2,
    name: 'Besi Uji',
    localUnit: 'bundle',
    knownUnit: 'BUAH',
    prices: { SIRIMAU: 200000, 'TELUK AMBON': 210000, BAGUALA: 220000 },
  },
  {
    rowNumber: 5,
    itemNumber: 3,
    name: 'Kabel Uji',
    localUnit: 'roll',
    knownUnit: 'M2',
    prices: { SIRIMAU: 300000, 'TELUK AMBON': 310000, BAGUALA: 320000 },
  },
  {
    rowNumber: 6,
    itemNumber: 4,
    name: 'Pipa Uji',
    localUnit: 'coil',
    knownUnit: 'M3',
    prices: { SIRIMAU: 400000, 'TELUK AMBON': 410000, BAGUALA: 420000 },
  },
];

/**
 * A three-jurisdiction regional matrix with THREE unheaded text columns: the
 * resource name, the document's own unit wording, and the same units restated
 * in vocabulary SIMPROK knows.
 */
export async function buildUnknownUnitVocabularyXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Kosakata Satuan');

  sheet.getCell('A1').value =
    'LEMBAR UJI KOSAKATA SATUAN LOKAL (BUKAN DATA NYATA)';

  // THE HEADER ROW NAMES ONLY THE JURISDICTIONS. The three text columns are
  // left deliberately untitled — that silence is what forces the question.
  for (const region of UNKNOWN_UNIT_REGIONS)
    sheet.getCell(UNKNOWN_UNIT_HEADER_ROW, UNKNOWN_UNIT_COLUMNS[region]).value =
      region;

  for (const row of UNKNOWN_UNIT_ROWS) {
    sheet.getCell(row.rowNumber, UNKNOWN_UNIT_COLUMNS.ROW_NUMBER).value =
      row.itemNumber;
    sheet.getCell(row.rowNumber, UNKNOWN_UNIT_COLUMNS.NAME).value = row.name;
    sheet.getCell(row.rowNumber, UNKNOWN_UNIT_COLUMNS.LOCAL_UNIT).value =
      row.localUnit;
    sheet.getCell(row.rowNumber, UNKNOWN_UNIT_COLUMNS.KNOWN_UNIT).value =
      row.knownUnit;
    for (const region of UNKNOWN_UNIT_REGIONS) {
      const cell = sheet.getCell(row.rowNumber, UNKNOWN_UNIT_COLUMNS[region]);
      cell.value = row.prices[region];
      cell.numFmt = CURRENCY_NUMFMT;
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

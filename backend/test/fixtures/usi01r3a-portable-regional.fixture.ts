import ExcelJS from 'exceljs';

/**
 * USI-01R3A §11 — THE PORTABLE REGIONAL FIXTURE.
 *
 * WHY THIS EXISTS. USI-01R3 proved per-row region isolation against the
 * Owner's real Ambon workbook, and that proof is excellent — it is also the
 * only proof there was. The real file lives outside the repository because it
 * is Owner business data, so its suite SKIPS wherever the file is absent:
 * every CI runner, every new developer machine, every clean clone. A
 * production invariant that is only guarded when one particular private file
 * happens to be present is not guarded.
 *
 * WHAT IS AND IS NOT IN HERE. No Owner price, no Owner resource name, no
 * Owner code, no fragment of Owner data of any kind. Every figure below is
 * invented and every name says "Uji". What is reproduced is strictly the
 * TECHNICAL SEMANTICS the real file exercises:
 *
 *   - three jurisdiction columns that must never read each other's cells;
 *   - a resource priced in some jurisdictions and blank in others;
 *   - a price cell holding text a machine cannot honestly resolve;
 *   - a name-only row with NO affirmative heading evidence;
 *   - a section title the source AFFIRMATIVELY spells in SIMPROK's own
 *     controlled grammar.
 *
 * The jurisdiction LABELS are the three real kecamatan names, because a label
 * is not business data — it is the public name of a place, and reusing it keeps
 * the portable proof and the real rehearsal legible as the same proof.
 */

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

export const PORTABLE_REGIONS = ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'] as const;
export type PortableRegion = (typeof PORTABLE_REGIONS)[number];

/** 1-based source columns, stated once so the tests assert against the SOURCE. */
export const PORTABLE_COLUMNS = {
  CODE: 1,
  NAME: 2,
  UNIT: 3,
  SIRIMAU: 4,
  'TELUK AMBON': 5,
  BAGUALA: 6,
} as const;

export const PORTABLE_HEADER_ROW = 3;

/**
 * Every physical row below the header, and exactly what each one is FOR.
 *
 * `null` means the source cell is genuinely empty; a string in a price slot
 * means the source wrote text where a number was expected.
 */
export const PORTABLE_ROWS: ReadonlyArray<{
  rowNumber: number;
  code: string | null;
  name: string;
  unit: string | null;
  prices: Record<PortableRegion, number | string | null>;
  /** What this row must be classified as, and why it is here. */
  expectedKind: 'RESOURCE_ROW' | 'STRUCTURAL_HEADING' | 'ROW_KIND_AMBIGUOUS';
  purpose: string;
}> = [
  {
    rowNumber: 4,
    code: 'P-01',
    name: 'Resource A Uji',
    unit: 'M3',
    prices: { SIRIMAU: 100000, 'TELUK AMBON': 110000, BAGUALA: null },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'REGPORT-02 — blank in Baguala, still a candidate there.',
  },
  {
    rowNumber: 5,
    code: 'P-02',
    name: 'Resource B Uji',
    unit: 'KG',
    prices: { SIRIMAU: null, 'TELUK AMBON': 200000, BAGUALA: 210000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'REGPORT-03 — blank in Sirimau, still a candidate there.',
  },
  {
    rowNumber: 6,
    code: 'P-03',
    name: 'Resource C Uji',
    unit: 'M2',
    // Text where a number belongs — the OCR damage the real workbook carries.
    prices: { SIRIMAU: 'Rp. -', 'TELUK AMBON': 300000, BAGUALA: 310000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'REGPORT-07 — dirty in Sirimau, and it borrows no sibling price.',
  },
  {
    rowNumber: 7,
    code: 'P-04',
    name: 'Resource D Uji',
    unit: 'BUAH',
    prices: { SIRIMAU: 400000, 'TELUK AMBON': 410000, BAGUALA: 420000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'A fully priced control row.',
  },
  {
    rowNumber: 8,
    code: 'P-05',
    name: 'Resource E Uji',
    unit: 'ZAK',
    prices: { SIRIMAU: 500000, 'TELUK AMBON': 510000, BAGUALA: 520000 },
    expectedKind: 'RESOURCE_ROW',
    purpose:
      'A second control row, so a numeric column is provable as numeric.',
  },
  {
    rowNumber: 9,
    code: null,
    // A name and nothing else. It could be an incomplete resource, a damaged
    // extraction, or a title — the source does not say, and USI-01R3A refuses
    // to decide for it.
    name: 'Uraian Tanpa Bukti Uji',
    unit: null,
    prices: { SIRIMAU: null, 'TELUK AMBON': null, BAGUALA: null },
    expectedKind: 'ROW_KIND_AMBIGUOUS',
    purpose: 'REGPORT-09 / ROWTRUTH-04 — unproven, therefore kept.',
  },
  {
    rowNumber: 10,
    code: 'S-02',
    // AFFIRMATIVE evidence: the source spells a section title in the controlled
    // grammar SIMPROK has owned since RM-02. Nothing is inferred from what this
    // row LACKS.
    name: 'DAFTAR HARGA SATUAN BAHAN',
    unit: null,
    prices: { SIRIMAU: null, 'TELUK AMBON': null, BAGUALA: null },
    expectedKind: 'STRUCTURAL_HEADING',
    purpose: 'ROWTRUTH-05 — proven title, and only then excluded.',
  },
];

/**
 * A three-jurisdiction regional matrix, small enough to read in one screen.
 *
 * The header carries KODE / URAIAN / SATUAN and three unlabelled-by-role
 * jurisdiction columns, which is what makes the shape detectable as a matrix
 * rather than as a flat table with one price column. The code column is what
 * keeps row 10 reachable at all: `detectSectioned` recognizes a sectioned price
 * list from the FIRST text in a row, so a title row whose leading cell holds a
 * section code stays inside the header-driven path — exactly the case where a
 * proven title must still be honoured.
 */
export async function buildPortableRegionalMatrixXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Portabel');

  // A title block above the table, so the header is found by evidence rather
  // than by position. Deliberately NOT in the section-title grammar.
  sheet.getCell('A1').value =
    'HARGA PER KECAMATAN — FIXTURE PORTABEL (BUKAN DATA NYATA)';

  sheet.getCell('A3').value = 'KODE';
  sheet.getCell('B3').value = 'URAIAN';
  sheet.getCell('C3').value = 'SATUAN';
  sheet.getCell('D3').value = PORTABLE_REGIONS[0];
  sheet.getCell('E3').value = PORTABLE_REGIONS[1];
  sheet.getCell('F3').value = PORTABLE_REGIONS[2];

  for (const row of PORTABLE_ROWS) {
    if (row.code !== null)
      sheet.getCell(row.rowNumber, PORTABLE_COLUMNS.CODE).value = row.code;
    sheet.getCell(row.rowNumber, PORTABLE_COLUMNS.NAME).value = row.name;
    if (row.unit !== null)
      sheet.getCell(row.rowNumber, PORTABLE_COLUMNS.UNIT).value = row.unit;
    for (const region of PORTABLE_REGIONS) {
      const value = row.prices[region];
      if (value === null) continue; // a genuinely empty source cell
      const cell = sheet.getCell(row.rowNumber, PORTABLE_COLUMNS[region]);
      cell.value = value;
      if (typeof value === 'number') cell.numFmt = CURRENCY_NUMFMT;
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

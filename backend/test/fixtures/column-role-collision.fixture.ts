import ExcelJS from 'exceljs';

/**
 * THE COLUMN-ROLE COLLISION FIXTURE — A MATRIX WITH NO COLUMN TITLES AT ALL.
 *
 * WHY THIS EXISTS. The Owner's real 934-row Ambon import was not defeated by a
 * hard workbook. It was accepted with the RESOURCE NAME column answered as the
 * SOURCE UNIT column: every row's unit cell address became its own name cell
 * address, and every row carried its resource name as its unit. Two things then
 * followed that nobody chose. `classifyPhysicalRow` reads `hasUnitEvidence`
 * from the unit column, so 40 category banners looked commercial and entered
 * the review room; and the Unit authority, asked whether a resource name is a
 * unit of measure, truthfully answered no for all 934 rows, so not one identity
 * pair could close.
 *
 * IT SURVIVED BECAUSE EVERY TEST SUPPLIED THE HONEST ANSWER. The real-workbook
 * suites pass `selectedNameColumn: 2, selectedUnitColumn: 4` and prove the happy
 * path beautifully. Nothing ever asked what happens when a person names one
 * column twice — and nothing could, because no fixture in the repository even
 * REACHED the column-role question. A shape whose columns carry titles never
 * asks it.
 *
 * WHAT IS AND IS NOT IN HERE. No Owner price, no Owner resource name, no Owner
 * code, no fragment of Owner data. Every figure is invented and every name says
 * "Uji". What is reproduced is strictly the TECHNICAL SEMANTICS that make the
 * collision reachable:
 *
 *   - three jurisdiction columns whose labels prove the shape is a matrix;
 *   - a resource-name column and a unit column with NO header text at all, so
 *     `columnRoles.required` is true and a human is asked which is which;
 *   - both of those columns therefore sitting in BOTH candidate pools, which is
 *     the surface the collision needs;
 *   - a name-only row with no unit, no price under any jurisdiction and no
 *     number — the banner class the collision silently promoted to a resource.
 *
 * NO ROLE WORD APPEARS IN ANY SCANNED CELL. Not "No", not "Uraian", not
 * "Satuan", not "Harga", and deliberately not "Kecamatan" — every one of those
 * is a header alias, and a single one would let the header-driven detector
 * recognise a role, answer the column question by itself, and quietly stop this
 * fixture from testing the thing it exists to test.
 */

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

export const COLLISION_REGIONS = ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'] as const;
export type CollisionRegion = (typeof COLLISION_REGIONS)[number];

/** 1-based source columns, stated once so tests assert against the SOURCE. */
export const COLLISION_COLUMNS = {
  ROW_NUMBER: 1,
  NAME: 2,
  UNIT: 3,
  SIRIMAU: 4,
  'TELUK AMBON': 5,
  BAGUALA: 6,
} as const;

export const COLLISION_HEADER_ROW = 2;

/**
 * Every physical row below the header, and exactly what each one is FOR.
 *
 * `null` means the source cell is genuinely empty.
 */
export const COLLISION_ROWS: ReadonlyArray<{
  rowNumber: number;
  /** The document's own item number. Absent on a banner, exactly as in life. */
  itemNumber: number | null;
  name: string;
  unit: string | null;
  prices: Record<CollisionRegion, number | null>;
  expectedKind: 'RESOURCE_ROW' | 'NO_COMMERCIAL_EVIDENCE';
  purpose: string;
}> = [
  {
    rowNumber: 3,
    itemNumber: 1,
    name: 'Resource A Uji',
    unit: 'M3',
    prices: { SIRIMAU: 100000, 'TELUK AMBON': 110000, BAGUALA: 120000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'A fully priced control row.',
  },
  {
    rowNumber: 4,
    itemNumber: 2,
    name: 'Resource B Uji',
    unit: 'KG',
    prices: { SIRIMAU: 200000, 'TELUK AMBON': null, BAGUALA: 210000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'Blank in one jurisdiction, still a candidate in all of them.',
  },
  {
    rowNumber: 5,
    itemNumber: 3,
    name: 'Resource C Uji',
    unit: 'M2',
    prices: { SIRIMAU: 300000, 'TELUK AMBON': 310000, BAGUALA: 320000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'A second control row, so the price columns are provably numeric.',
  },
  {
    rowNumber: 6,
    itemNumber: 4,
    name: 'Resource D Uji',
    unit: 'BUAH',
    prices: { SIRIMAU: 400000, 'TELUK AMBON': 410000, BAGUALA: 420000 },
    expectedKind: 'RESOURCE_ROW',
    purpose: 'A third control row.',
  },
  {
    rowNumber: 7,
    // A name and nothing else — no unit, no price under ANY jurisdiction, and
    // no item number. THIS is the row the collision damages: read honestly it
    // carries no commercial evidence and is excluded, but the moment the NAME
    // column is treated as the unit column it acquires unit evidence from its
    // own name and becomes a resource candidate nobody can resolve.
    itemNumber: null,
    name: 'BATUAN UJI',
    unit: null,
    prices: { SIRIMAU: null, 'TELUK AMBON': null, BAGUALA: null },
    expectedKind: 'NO_COMMERCIAL_EVIDENCE',
    purpose:
      'COLLIDE-05 — the banner class that a name-as-unit answer promotes into the review room.',
  },
];

/**
 * A three-jurisdiction regional matrix whose name and unit columns carry no
 * header whatsoever — the shape that forces SIMPROK to ask, once, which column
 * is which.
 *
 * `withUnitColumn: false` builds the degenerate variant in which the document
 * offers only ONE non-jurisdiction text column. There is then no honest answer
 * to give — the single candidate cannot be both roles — and the fixture exists
 * to prove that SIMPROK still refuses the contradiction and still offers a
 * non-empty question rather than an empty one.
 */
export async function buildUnheadedRegionalMatrixXlsx(
  options: { withUnitColumn?: boolean } = {},
): Promise<Buffer> {
  const withUnitColumn = options.withUnitColumn ?? true;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Tanpa Judul Kolom');

  // A preamble above the table, so the header is found by evidence rather than
  // by position. Carries no header alias of any kind.
  sheet.getCell('A1').value =
    'LEMBAR UJI PORTABEL TANPA JUDUL KOLOM (BUKAN DATA NYATA)';

  // THE HEADER ROW NAMES ONLY THE JURISDICTIONS. The name and unit columns
  // above the data are left deliberately blank — that silence is the fixture.
  sheet.getCell(COLLISION_HEADER_ROW, COLLISION_COLUMNS.SIRIMAU).value =
    COLLISION_REGIONS[0];
  sheet.getCell(COLLISION_HEADER_ROW, COLLISION_COLUMNS['TELUK AMBON']).value =
    COLLISION_REGIONS[1];
  sheet.getCell(COLLISION_HEADER_ROW, COLLISION_COLUMNS.BAGUALA).value =
    COLLISION_REGIONS[2];

  for (const row of COLLISION_ROWS) {
    if (row.itemNumber !== null)
      sheet.getCell(row.rowNumber, COLLISION_COLUMNS.ROW_NUMBER).value =
        row.itemNumber;
    sheet.getCell(row.rowNumber, COLLISION_COLUMNS.NAME).value = row.name;
    if (withUnitColumn && row.unit !== null)
      sheet.getCell(row.rowNumber, COLLISION_COLUMNS.UNIT).value = row.unit;
    for (const region of COLLISION_REGIONS) {
      const value = row.prices[region];
      if (value === null) continue; // a genuinely empty source cell
      const cell = sheet.getCell(row.rowNumber, COLLISION_COLUMNS[region]);
      cell.value = value;
      cell.numFmt = CURRENCY_NUMFMT;
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

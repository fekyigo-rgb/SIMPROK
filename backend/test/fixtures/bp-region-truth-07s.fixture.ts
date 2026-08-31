import ExcelJS from 'exceljs';

/**
 * BP-REGION-TRUTH-07S — TWO WORKBOOKS OF THE SAME SHAPE, ONE WORD APART.
 *
 * The question this task exists for cannot be answered by a workbook's
 * STRUCTURE. A jurisdiction matrix and a trade-term matrix are built the same
 * way: distinct labels over parallel numeric price columns, one text column of
 * resource names beside them. Anything that told them apart by the SPELLING of
 * those labels would be fuzzy geography wearing a proof's clothes.
 *
 * So these fixtures vary exactly ONE thing — whether the source writes a region
 * word of its own above its columns — and the suite asserts opposite verdicts
 * from it. That is the whole boundary:
 *
 *   KECAMATAN over SIRIMAU | TELUK AMBON | BAGUALA  → the source claims places
 *   (nothing) over GROSIR | ECERAN                  → the source claims nothing
 *
 * The banner is written as a REPEATED cell across its span, not as one merged
 * cell, because that is how the Owner's real Ambon workbook writes it.
 *
 * NOT REAL DATA. The prices are invented; only the SHAPE is faithful.
 */

const CURRENCY_NUMFMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

/** The word the source itself writes over its jurisdiction columns. */
export const GEO_BANNER_WORD = 'KECAMATAN';

export const GEO_SCOPE_LABELS = ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'] as const;

/** Parallel price columns that are NOT places. No region word anywhere. */
export const NON_GEO_SCOPE_LABELS = ['GROSIR', 'ECERAN'] as const;

/** The header word over a per-row region column — a ROW_VALUE scope. */
export const ROW_VALUE_REGION_HEADER = 'WILAYAH';

export const ROW_VALUE_REGION_LABELS = ['AMBON', 'MASOHI'] as const;

const RESOURCES = [
  { name: 'Batu Kali', unit: 'M3' },
  { name: 'Batu Belah', unit: 'M3' },
  { name: 'Pasir Pasang', unit: 'M3' },
] as const;

/**
 * THE OWNER-SHAPED WORKBOOK: a "KECAMATAN" banner over three named jurisdiction
 * columns, with the resource and unit columns left entirely unheaded.
 *
 * Row 1  title
 * Row 2  banner   —  KECAMATAN  KECAMATAN  KECAMATAN
 * Row 3  labels   —  SIRIMAU    TELUK AMBON  BAGUALA
 * Row 4+ data
 */
export async function buildGeographicScopeMatrixXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Wilayah Sumber');

  sheet.getCell('A1').value = 'DAFTAR HARGA UJI 07S (BUKAN DATA NYATA)';

  GEO_SCOPE_LABELS.forEach((label, index) => {
    const column = 4 + index;
    sheet.getCell(2, column).value = GEO_BANNER_WORD;
    sheet.getCell(3, column).value = label;
  });

  RESOURCES.forEach((resource, index) => {
    const rowNumber = 4 + index;
    sheet.getCell(rowNumber, 1).value = index + 1;
    sheet.getCell(rowNumber, 2).value = resource.name;
    sheet.getCell(rowNumber, 3).value = resource.unit;
    GEO_SCOPE_LABELS.forEach((_, scopeIndex) => {
      const cell = sheet.getCell(rowNumber, 4 + scopeIndex);
      cell.value = 300000 + index * 50000 + scopeIndex * 1000;
      cell.numFmt = CURRENCY_NUMFMT;
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * THE CONTROL: the SAME shape with NO region word anywhere, and labels that are
 * trade terms rather than places.
 *
 * A source may legitimately price one resource two ways. SIMPROK must ask which
 * column to read — that question is about the shape and is unchanged — and must
 * NOT then suggest the answer has anything to do with a canonical Region.
 */
export async function buildNonGeographicScopeMatrixXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Kolom Non-Wilayah');

  sheet.getCell('A1').value =
    'DAFTAR HARGA UJI 07S NON-WILAYAH (BUKAN DATA NYATA)';

  NON_GEO_SCOPE_LABELS.forEach((label, index) => {
    sheet.getCell(3, 4 + index).value = label;
  });

  RESOURCES.forEach((resource, index) => {
    const rowNumber = 4 + index;
    sheet.getCell(rowNumber, 1).value = index + 1;
    sheet.getCell(rowNumber, 2).value = resource.name;
    sheet.getCell(rowNumber, 3).value = resource.unit;
    NON_GEO_SCOPE_LABELS.forEach((_, scopeIndex) => {
      const cell = sheet.getCell(rowNumber, 4 + scopeIndex);
      cell.value = 300000 + index * 50000 + scopeIndex * 7000;
      cell.numFmt = CURRENCY_NUMFMT;
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * A FLAT table that names its region PER ROW under a "WILAYAH" header — the
 * OTHER lawful way a source states geography, and the one whose behaviour must
 * not regress while the column-matrix case is being repaired.
 */
export async function buildRowValueRegionTableXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lembar Uji Wilayah Per Baris');

  sheet.getCell('A1').value =
    'DAFTAR HARGA UJI 07S PER BARIS (BUKAN DATA NYATA)';

  sheet.getCell(2, 1).value = 'NO';
  sheet.getCell(2, 2).value = 'URAIAN';
  sheet.getCell(2, 3).value = 'SATUAN';
  sheet.getCell(2, 4).value = ROW_VALUE_REGION_HEADER;
  sheet.getCell(2, 5).value = 'HARGA';

  let rowNumber = 3;
  for (const region of ROW_VALUE_REGION_LABELS) {
    RESOURCES.forEach((resource, index) => {
      sheet.getCell(rowNumber, 1).value = index + 1;
      sheet.getCell(rowNumber, 2).value = resource.name;
      sheet.getCell(rowNumber, 3).value = resource.unit;
      sheet.getCell(rowNumber, 4).value = region;
      const cell = sheet.getCell(rowNumber, 5);
      cell.value = 300000 + index * 50000;
      cell.numFmt = CURRENCY_NUMFMT;
      rowNumber += 1;
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

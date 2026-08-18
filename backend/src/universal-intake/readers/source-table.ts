/**
 * USI-01 §4/§5 — THE FORMAT-NEUTRAL SOURCE TABLE.
 *
 * A reader's entire job is to turn bytes into this, and nothing else. It
 * carries no business meaning at all: no notion of "price", "unit" or
 * "resource" appears here. That separation is what makes §5 true — FILE
 * FORMAT AND BUSINESS-TABLE SHAPE ARE INDEPENDENT — and what lets a third
 * reader be added later without any Basic Price verification/publication code
 * changing (test A3).
 */

/**
 * How a cell's position is SPELLED, so a locator can never be mistaken for a
 * coordinate system it does not belong to (§12: no fake Excel cell addresses
 * for non-Excel sources).
 *
 * EXCEL_A1  "F9" — a real spreadsheet cell reference. Only a reader that
 *           actually read a spreadsheet may emit this.
 * CSV_RC    "R12C6" — line 12, field 6 of a delimited text file. Genuine
 *           evidence, and structurally impossible to misread as A1 notation.
 */
export type SourceLocatorDialect = 'EXCEL_A1' | 'CSV_RC';

/**
 * Native, format-specific evidence for one spreadsheet cell. Present only for
 * formats that HAVE typed cells; a delimited text file has no such thing and
 * leaves this null rather than pretending (LAW 2).
 */
export interface SpreadsheetCellEvidence {
  /** ExcelJS ValueType. Meaningful only under the EXCEL_A1 dialect. */
  cellType: number;
  numericRoundTripString: string | null;
  textValue: string | null;
  formulaText: string | null;
  cachedResultRoundTripString: string | null;
  formulaError: string | null;
  numberFormat: string | null;
  /**
   * Format-level observations about the cell's shape (e.g. "this formula
   * cached no result"). Observations, never judgements: whether an observation
   * is a PROBLEM depends on what the domain wanted from the cell, and that
   * decision belongs to the adapter (LAW 4).
   */
  shapeDiagnostics: string[];
}

export interface SourceCell {
  /** Verbatim as the reader read it, before any trimming (LAW 2). */
  rawText: string | null;
  /**
   * Whitespace-trimmed reading of the same cell, empty-as-null. Trimming is
   * the only normalization a reader is permitted (LAW 5 "safe deterministic").
   */
  text: string | null;
  native: SpreadsheetCellEvidence | null;
}

export interface SourceRow {
  /** 1-based PHYSICAL position in the source: worksheet row, or file line. */
  number: number;
  /** Dense by column index (0 = column 1). A null entry is a genuinely empty cell. */
  cells: Array<SourceCell | null>;
}

export interface SourceTable {
  readerId: string;
  readerContractVersion: string;
  locatorDialect: SourceLocatorDialect;
  /** Worksheet name, or the logical table name a flat file is given. */
  name: string;
  /** Highest physical row number the reader scanned. */
  scannedRowCount: number;
  columnCount: number;
  /** Sparse: rows with no content at all are simply absent. */
  rows: SourceRow[];
}

export interface SourceRead {
  readerId: string;
  readerContractVersion: string;
  tables: SourceTable[];
  /**
   * Format-level notes about HOW the package had to be read (e.g. a dialect
   * normalization). Recorded so an adaptation is visible rather than silent.
   */
  readerDiagnostics?: string[];
}

const A1_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Converts a 1-based column number to its spreadsheet letters (1 -> A, 27 -> AA). */
export function columnLetters(columnNumber: number): string {
  let n = columnNumber;
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = A1_LETTERS[remainder] + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * The single place a source locator is SPELLED. Keeping it here — rather than
 * letting each adapter format its own — is what guarantees a CSV row can never
 * acquire an A1 address by accident: the dialect travels with the table, and
 * the spelling is derived from it.
 */
export function formatLocator(
  dialect: SourceLocatorDialect,
  rowNumber: number,
  columnNumber: number,
): string {
  switch (dialect) {
    case 'EXCEL_A1':
      return `${columnLetters(columnNumber)}${rowNumber}`;
    case 'CSV_RC':
      return `R${rowNumber}C${columnNumber}`;
  }
}

export function cellAt(row: SourceRow, columnNumber: number): SourceCell | null {
  return row.cells[columnNumber - 1] ?? null;
}

export function textAt(row: SourceRow, columnNumber: number): string | null {
  return cellAt(row, columnNumber)?.text ?? null;
}

/**
 * The locator for a field whose COLUMN does not exist in this source at all —
 * as opposed to a cell that exists and is empty, which has a real locator.
 *
 * It is deliberately not spellable in either dialect, so it can never be read
 * as a position. "There was no code column in this file" and "the code cell at
 * D39 was blank" are different facts, and §12 forbids collapsing the first into
 * a fabricated coordinate for the second.
 */
export const NO_SOURCE_COLUMN_LOCATOR = 'NO_SOURCE_COLUMN';

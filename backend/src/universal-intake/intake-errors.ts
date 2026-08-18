/**
 * USI-01 — the complete, narrow diagnostic vocabulary of the Universal Smart
 * Intake boundary (§17 ERROR HONESTY).
 *
 * Every one of these names a DIFFERENT real-world situation, and the split
 * exists so a human is never told "invalid file" when the truth is "SIMPROK
 * cannot read this format yet" or "your workbook is fine, but it holds three
 * candidate tables and SIMPROK refuses to pick for you".
 *
 * Three of them (WORKBOOK_HAS_NO_SHEETS, WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND,
 * SOURCE_ROW_LIMIT_EXCEEDED) are PRE-EXISTING contract strings that the Basic
 * Price import boundary already returns to callers. They are preserved here
 * verbatim rather than renamed: an error string a client already branches on is
 * an interface, not an implementation detail.
 */
export const INTAKE_ERRORS = {
  /** The envelope carried no bytes at all. */
  SOURCE_BYTES_REQUIRED: 'SOURCE_BYTES_REQUIRED',
  /** Bounded-input protection (§14): the payload is larger than intake accepts. */
  SOURCE_EXCEEDS_MAX_BYTES: 'SOURCE_EXCEEDS_MAX_BYTES',
  /**
   * No registered reader claims this format. This is SIMPROK's limitation and
   * says so — it never blames the sender's file (§17).
   */
  UNSUPPORTED_SOURCE_FORMAT: 'UNSUPPORTED_SOURCE_FORMAT',
  /** A reader claimed the format and then could not decode the bytes. */
  SOURCE_UNREADABLE: 'SOURCE_UNREADABLE',
  /** Legacy contract string — an XLSX container with zero worksheets. */
  WORKBOOK_HAS_NO_SHEETS: 'WORKBOOK_HAS_NO_SHEETS',
  /** Legacy contract string — a named table/sheet was asked for and is not there. */
  WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND: 'WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND',
  /** Legacy contract string — bounded-row protection (§14/§15). */
  SOURCE_ROW_LIMIT_EXCEEDED: 'SOURCE_ROW_LIMIT_EXCEEDED',
  /** Readable, but no table in it proves a price-table shape. */
  NO_PRICE_TABLE_DETECTED: 'NO_PRICE_TABLE_DETECTED',
  /** More than one table proved a price-table shape — a human picks, once. */
  SOURCE_TABLE_AMBIGUOUS: 'SOURCE_TABLE_AMBIGUOUS',
  /** One table proved more than one plausible structure — a human picks, once. */
  SOURCE_STRUCTURE_AMBIGUOUS: 'SOURCE_STRUCTURE_AMBIGUOUS',
  /**
   * A regional matrix was proven. A batch is region-scoped, so exactly one of
   * its jurisdiction columns must be named before any candidate is created.
   */
  REGION_COLUMN_SELECTION_REQUIRED: 'REGION_COLUMN_SELECTION_REQUIRED',
  /**
   * The source declares no LABOR/MATERIAL/EQUIPMENT sections of its own, so a
   * human must state which one this batch is. SIMPROK never infers it.
   */
  SECTION_DECLARATION_REQUIRED: 'SECTION_DECLARATION_REQUIRED',
  /**
   * The table's shape is proven but its resource-name / unit columns carry no
   * header, so nothing in the source states which they are. SIMPROK offers the
   * candidates with real sample values and lets a human decide once.
   */
  COLUMN_ROLE_SELECTION_REQUIRED: 'COLUMN_ROLE_SELECTION_REQUIRED',
  /** The named jurisdiction column is not one of the detected columns. */
  REGION_COLUMN_NOT_FOUND: 'REGION_COLUMN_NOT_FOUND',
} as const;

export type IntakeErrorCode = (typeof INTAKE_ERRORS)[keyof typeof INTAKE_ERRORS];

/**
 * Carries a machine-readable code plus the evidence a human needs to act.
 * `details` never contains raw payload content beyond the structural labels
 * already present in headers (§14 safe logging).
 */
export class IntakeError extends Error {
  constructor(
    readonly code: IntakeErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'IntakeError';
  }
}

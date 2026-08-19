import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { INTAKE_ERRORS, IntakeError } from '../intake-errors';
import { SourceEnvelope } from '../source-envelope';
import { SourceReader } from './source-reader';
import {
  SourceCell,
  SourceRead,
  SourceRow,
  SourceTable,
  SpreadsheetCellEvidence,
} from './source-table';

export const XLSX_READER_ID = 'XLSX_EXCELJS';
export const XLSX_READER_CONTRACT_VERSION = 'USI01_XLSX_V1';

/** §14/§15 bounded workbook processing. Preserved from the RM-02 boundary. */
export const MAX_SOURCE_ROWS = 20_000;
/**
 * Columns beyond this are not read. A regional matrix needs a handful; nothing
 * SIMPROK has met needs sixty-four, and an unbounded column count is the other
 * half of a decompression bomb's surface area (§14).
 */
export const MAX_SOURCE_COLUMNS = 64;

/**
 * Format-level facts about a cell's NATIVE SHAPE. These are observations, not
 * judgements: "this formula cached no result" is true whether or not anyone
 * wanted a price from it. The domain adapter is what turns an observation into
 * a row error (LAW 4 — parser confidence is not truth confidence).
 */
export const CELL_SHAPE_DIAGNOSTICS = {
  FORMULA_SHAPE_UNRECOGNIZED: 'FORMULA_SHAPE_UNRECOGNIZED',
  NO_CACHED_RESULT: 'NO_CACHED_RESULT',
  CACHED_RESULT_IS_TEXT: 'CACHED_RESULT_IS_TEXT',
  FORMULA_RESULT_IS_ERROR: 'FORMULA_RESULT_IS_ERROR',
  CACHED_RESULT_SHAPE_UNRECOGNIZED: 'CACHED_RESULT_SHAPE_UNRECOGNIZED',
  CELL_SHAPE_UNRECOGNIZED: 'CELL_SHAPE_UNRECOGNIZED',
} as const;

/**
 * Exhaustive ExcelJS cell-value classification for text-shaped reading.
 * Handles plain string, number-as-text, rich text runs, formula with a
 * string/number cached result (covers both direct and shared formulas — both
 * expose `.result` on `cell.value` when a cached result exists), and hyperlink
 * display text. Never coerces an unrecognized shape to `[object Object]` or
 * `String(value)` — returns null instead, which surfaces as a missing field.
 *
 * Carried over verbatim from the RM-02 Basic Price adapter this reader
 * subsumed, because its behaviour is already Owner-accepted evidence.
 */
function cellDisplayText(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  switch (cell.type) {
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString:
      return String(value).trim() || null;
    case ExcelJS.ValueType.Number:
      return String(value);
    case ExcelJS.ValueType.RichText: {
      const richText = (value as { richText?: Array<{ text: string }> }).richText;
      if (!richText) return null;
      const joined = richText
        .map((part) => part.text)
        .join('')
        .trim();
      return joined || null;
    }
    case ExcelJS.ValueType.Formula: {
      const formulaValue = value as { result?: unknown };
      const result = formulaValue.result;
      if (typeof result === 'string') return result.trim() || null;
      if (typeof result === 'number') return String(result);
      return null; // no cached result, or result is an error/object shape
    }
    case ExcelJS.ValueType.Hyperlink: {
      const hyperlinkValue = value as { text?: unknown };
      return typeof hyperlinkValue.text === 'string'
        ? hyperlinkValue.text.trim() || null
        : null;
    }
    default:
      return null;
  }
}

/** The same reading WITHOUT the trim, so LAW 2's raw truth survives. */
function cellRawText(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  switch (cell.type) {
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString:
    case ExcelJS.ValueType.Number:
      return String(value);
    case ExcelJS.ValueType.RichText: {
      const richText = (value as { richText?: Array<{ text: string }> }).richText;
      return richText ? richText.map((part) => part.text).join('') : null;
    }
    case ExcelJS.ValueType.Formula: {
      const result = (value as { result?: unknown }).result;
      if (typeof result === 'string') return result;
      if (typeof result === 'number') return String(result);
      return null;
    }
    case ExcelJS.ValueType.Hyperlink: {
      const text = (value as { text?: unknown }).text;
      return typeof text === 'string' ? text : null;
    }
    default:
      return null;
  }
}

/**
 * Full native-evidence capture. Every recognized ExcelJS value shape is
 * handled explicitly; anything outside the enumerated set is REPORTED as
 * unrecognized rather than coerced. No rounding, no canonicalization and no
 * business meaning — all three belong to the domain adapter.
 */
function nativeEvidence(cell: ExcelJS.Cell): SpreadsheetCellEvidence {
  const shapeDiagnostics: string[] = [];
  let numericRoundTripString: string | null = null;
  let textValue: string | null = null;
  let formulaText: string | null = null;
  let cachedResultRoundTripString: string | null = null;
  let formulaError: string | null = null;

  const value = cell.value;

  switch (cell.type) {
    case ExcelJS.ValueType.Number:
      numericRoundTripString = String(value as number);
      break;
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString:
      textValue = String(value);
      break;
    case ExcelJS.ValueType.Formula: {
      const formulaValue = value as {
        formula?: unknown;
        sharedFormula?: unknown;
        result?: unknown;
      };
      if (typeof formulaValue.formula === 'string') {
        formulaText = formulaValue.formula;
      } else if (typeof formulaValue.sharedFormula === 'string') {
        // ExcelJS's `.formula`/`.result` convenience getters are unreliable for
        // shared-formula cells (confirmed empirically against the real source
        // workbook) — the raw value object is read directly instead. The
        // formula text itself lives only on the master cell; the reference is
        // retained as honest evidence, not fabricated text.
        formulaText = `[shared-formula-ref:${formulaValue.sharedFormula}]`;
      } else {
        shapeDiagnostics.push(CELL_SHAPE_DIAGNOSTICS.FORMULA_SHAPE_UNRECOGNIZED);
      }

      const result = formulaValue.result;
      if (result === undefined) {
        shapeDiagnostics.push(CELL_SHAPE_DIAGNOSTICS.NO_CACHED_RESULT);
      } else if (typeof result === 'number') {
        cachedResultRoundTripString = String(result);
      } else if (typeof result === 'string') {
        shapeDiagnostics.push(CELL_SHAPE_DIAGNOSTICS.CACHED_RESULT_IS_TEXT);
      } else if (
        result &&
        typeof result === 'object' &&
        'error' in (result as Record<string, unknown>)
      ) {
        formulaError = String((result as { error: unknown }).error);
        shapeDiagnostics.push(CELL_SHAPE_DIAGNOSTICS.FORMULA_RESULT_IS_ERROR);
      } else {
        shapeDiagnostics.push(
          CELL_SHAPE_DIAGNOSTICS.CACHED_RESULT_SHAPE_UNRECOGNIZED,
        );
      }
      break;
    }
    case ExcelJS.ValueType.Error: {
      const errorValue = value as { error?: unknown };
      formulaError =
        typeof errorValue.error === 'string' ? errorValue.error : 'ERROR_CELL';
      break;
    }
    case ExcelJS.ValueType.Date:
    case ExcelJS.ValueType.Boolean:
    case ExcelJS.ValueType.RichText:
    case ExcelJS.ValueType.Hyperlink:
    case ExcelJS.ValueType.Null:
    case ExcelJS.ValueType.Merge:
      break;
    default:
      shapeDiagnostics.push(CELL_SHAPE_DIAGNOSTICS.CELL_SHAPE_UNRECOGNIZED);
  }

  return {
    cellType: cell.type,
    numericRoundTripString,
    textValue,
    formulaText,
    cachedResultRoundTripString,
    formulaError,
    numberFormat: cell.numFmt ?? null,
    shapeDiagnostics,
  };
}

/**
 * USI-01 §4 — the XLSX reader. Structure and meaning detection live entirely
 * downstream; this class knows only how to turn a workbook into grids.
 *
 * SECURITY (§14): macros and embedded scripts are never executed — ExcelJS
 * decodes the OOXML package as data. Formulas are read as TEXT plus their
 * workbook-cached result; SIMPROK never evaluates a formula and never resolves
 * an external workbook reference, so a `[1]ANALISA!C94` link is retained as
 * evidence and never fetched (no SSRF surface).
 */
export class XlsxSourceReader implements SourceReader {
  readonly id = XLSX_READER_ID;
  readonly contractVersion = XLSX_READER_CONTRACT_VERSION;
  readonly extensions = ['.xlsx'] as const;
  readonly mediaTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ] as const;

  async read(envelope: SourceEnvelope): Promise<SourceRead> {
    let workbook = new ExcelJS.Workbook();
    let normalized = false;
    try {
      await workbook.xlsx.load(envelope.bytes as any);
    } catch (firstError) {
      // SECOND CHANCE, AND ONLY FOR A REASON.
      //
      // The Owner's real IKK workbook is valid OOXML that ExcelJS cannot read:
      // it was written by a generator that puts the SpreadsheetML namespace on
      // an "x:" prefix (<x:workbook>, <x:sheet>) rather than making it the
      // default. ExcelJS matches unprefixed local names, so it sees no sheets
      // at all. That is SIMPROK's reader limitation, not a fault in the
      // document, and §17 forbids reporting it as one.
      //
      // So a normalized copy is attempted ONCE. The happy path is untouched —
      // every workbook that already loaded still loads the same way, first try.
      try {
        workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load((await normalizeOoxmlDialect(envelope.bytes)) as any);
        normalized = true;
      } catch {
        // Report the ORIGINAL failure: the normalization is an internal retry,
        // and its error would only describe a file the sender never sent.
        throw new IntakeError(INTAKE_ERRORS.SOURCE_UNREADABLE, {
          readerId: this.id,
          reason: firstError instanceof Error ? firstError.message : String(firstError),
        });
      }
    }

    if (workbook.worksheets.length === 0) {
      throw new IntakeError(INTAKE_ERRORS.WORKBOOK_HAS_NO_SHEETS);
    }

    const tables = workbook.worksheets.map((sheet) => this.readSheet(sheet));
    return {
      readerId: this.id,
      readerContractVersion: this.contractVersion,
      tables,
      // Recorded, not hidden: a reader that had to adapt says so, and the
      // archived bytes remain the unmodified original either way.
      readerDiagnostics: normalized ? [XLSX_READER_DIAGNOSTICS.OOXML_DIALECT_NORMALIZED] : [],
    };
  }

  private readSheet(sheet: ExcelJS.Worksheet): SourceTable {
    if (sheet.rowCount > MAX_SOURCE_ROWS) {
      throw new IntakeError(INTAKE_ERRORS.SOURCE_ROW_LIMIT_EXCEEDED, {
        rowCount: sheet.rowCount,
        maxRows: MAX_SOURCE_ROWS,
      });
    }

    // At least eight columns are always materialized so a locator exists for an
    // EMPTY cell in a known layout position — "D39 is blank" is itself evidence
    // a row needs, and inventing that address later would be exactly the
    // fabrication §12 forbids.
    const columnCount = Math.min(
      Math.max(sheet.columnCount, 8),
      MAX_SOURCE_COLUMNS,
    );

    const rows: SourceRow[] = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const sheetRow = sheet.getRow(rowNumber);
      const cells: Array<SourceCell | null> = new Array(columnCount).fill(null);
      let hasContent = false;

      for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
        const cell = sheetRow.getCell(columnNumber);
        // A genuinely absent cell stays absent. Every other shape — including
        // Merge, Error and Boolean — is materialized, because "there is
        // something here and it is not a number" is a different fact from
        // "there is nothing here", and the domain must be able to tell them
        // apart.
        if (cell.type === ExcelJS.ValueType.Null) continue;
        cells[columnNumber - 1] = {
          rawText: cellRawText(cell),
          text: cellDisplayText(cell),
          native: nativeEvidence(cell),
        };
        hasContent = true;
      }

      if (hasContent) rows.push({ number: rowNumber, cells });
    }

    return {
      readerId: this.id,
      readerContractVersion: this.contractVersion,
      locatorDialect: 'EXCEL_A1',
      name: sheet.name,
      scannedRowCount: sheet.rowCount,
      columnCount,
      rows,
    };
  }
}

/**
 * The ExcelJS `ValueType` constants, re-exported as plain numbers so the Basic
 * Price domain adapter can NAME a spreadsheet cell shape without importing a
 * spreadsheet library. `BasicPriceImportRow.rawPriceCellType` already stores
 * these values for every XLSX row ever imported, so they are an interface, not
 * an implementation detail.
 */
export const SPREADSHEET_VALUE_TYPE = {
  NULL: ExcelJS.ValueType.Null,
  MERGE: ExcelJS.ValueType.Merge,
  NUMBER: ExcelJS.ValueType.Number,
  STRING: ExcelJS.ValueType.String,
  DATE: ExcelJS.ValueType.Date,
  HYPERLINK: ExcelJS.ValueType.Hyperlink,
  FORMULA: ExcelJS.ValueType.Formula,
  SHARED_STRING: ExcelJS.ValueType.SharedString,
  RICH_TEXT: ExcelJS.ValueType.RichText,
  BOOLEAN: ExcelJS.ValueType.Boolean,
  ERROR: ExcelJS.ValueType.Error,
} as const;


export const XLSX_READER_DIAGNOSTICS = {
  /** The package had to be namespace-normalized before ExcelJS could read it. */
  OOXML_DIALECT_NORMALIZED: 'OOXML_DIALECT_NORMALIZED',
} as const;

/**
 * Rewrites an OOXML package into the dialect ExcelJS reliably reads.
 *
 * THIS NEVER TOUCHES THE OWNER'S FILE, AND NEVER TOUCHES CELL DATA. It works on
 * an in-memory copy, and the bytes SIMPROK archives and hashes are always the
 * unmodified original — so raw source truth (LAW 2.2) is exactly as it was.
 *
 * Two mechanical, deterministic transformations, both proven necessary against
 * the Owner's real workbook:
 *
 *   1. The SpreadsheetML namespace prefix is removed, making it the default
 *      namespace. `<x:sheet name="…">` becomes `<sheet name="…">`; the "r:"
 *      relationship prefix is deliberately preserved, because ExcelJS looks for
 *      `r:id` literally.
 *
 *   2. Excel Table (ListObject) parts are dropped, along with the relationships
 *      and `<tableParts>` entries that point at them. ExcelJS builds a table
 *      model from these and produces an undefined entry when it cannot, which
 *      crashes worksheet construction. No CELL is defined by them — a table's
 *      column names also exist in its header row — so nothing readable is lost.
 */
async function normalizeOoxmlDialect(bytes: Buffer): Promise<Buffer> {
  const source = await JSZip.loadAsync(bytes);
  const normalized = new JSZip();

  for (const name of Object.keys(source.files)) {
    const entry = source.files[name];
    if (entry.dir) continue;
    // Table parts are dropped wholesale — see (2) above.
    if (name.startsWith('xl/tables/')) continue;

    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const xml = await entry.async('string');
      normalized.file(name, normalizeXmlPart(xml));
    } else {
      normalized.file(name, await entry.async('nodebuffer'));
    }
  }

  return normalized.generateAsync({ type: 'nodebuffer' });
}

function normalizeXmlPart(xml: string): string {
  // Only the prefix bound to the SpreadsheetML main namespace is stripped, and
  // only where it introduces an ELEMENT. Attribute prefixes such as r:id are
  // left exactly as they are.
  const prefixMatch = xml.match(
    new RegExp(
      'xmlns:([A-Za-z0-9_]+)="' +
        'http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ),
  );

  let out = xml;
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    out = out
      .split(`<${prefix}:`)
      .join('<')
      .split(`</${prefix}:`)
      .join('</')
      .split(`xmlns:${prefix}=`)
      .join('xmlns=');
  }

  // Remove every reference to the table parts dropped above, so the package
  // stays internally consistent rather than pointing at something absent.
  const TABLE_PART = '/xl/tables/';
  return out
    .replace(new RegExp('<Relationship[^>]*' + TABLE_PART + '[^>]*/>', 'g'), '')
    .replace(new RegExp('<Override[^>]*' + TABLE_PART + '[^>]*/>', 'g'), '')
    .replace(new RegExp('<tableParts[\\s\\S]*?</tableParts>', 'g'), '')
    .replace(new RegExp('<tableParts[^>]*/>', 'g'), '');
}

import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';

export const BASIC_PRICE_PARSER_CONTRACT_VERSION = 'RM02_BASIC_PRICE_01_V1';
export const MAX_SOURCE_ROWS = 20_000;

export type BasicPriceImportKnowledgeSection = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

export interface BasicPriceImportKnowledgeRow {
  sourceSection: BasicPriceImportKnowledgeSection;
  sourceRowNumber: number;
  sourceCodeCellAddress: string;
  sourceNameCellAddress: string;
  sourceUnitCellAddress: string;
  sourcePriceCellAddress: string;

  rawResourceCodeText: string | null;
  rawResourceNameText: string;
  rawUnitText: string | null;

  rawPriceCellType: number;
  rawPriceNumericRoundTripString: string | null;
  rawPriceTextValue: string | null;
  rawPriceFormulaText: string | null;
  rawPriceCachedResultRoundTripString: string | null;
  rawPriceFormulaError: string | null;
  rawPriceNumberFormat: string | null;
  rawPriceDisplayText: string | null;

  // Never canonical until a human resolves/submits the row (see
  // 01-RM02B0-SCHEMA-CONTRACT.md §7). Null when no numeric evidence exists
  // to round at all (text/error/empty price cell).
  proposedCanonicalPrice: string | null;
  canonicalRoundingMode: string | null;

  warnings: string[];
  errors: string[];
}

export interface BasicPriceImportKnowledgeObject {
  parserContractVersion: string;
  sourceSha256: string;
  fileName: string;
  sheetName: string;
  totalSourceRows: number;
  rows: BasicPriceImportKnowledgeRow[];
}

// Section markers, column-header marker, and column layout are all
// evidence-derived from the reconfirmed real source workbook
// (data/first-real-input/BASIC PRICE(1).xlsx, single sheet "HARGA SATUAN
// UPAH DAN BAHAN"): three sections, each introduced by a full-row title
// and a "NO" column-header row, sharing one column layout
// (B=no, C=name, D=code, E=unit, F=price, G=notes/KET -- not captured,
// not part of BasicPriceImportRow's design).
const SECTION_MARKERS: Array<{ pattern: RegExp; section: BasicPriceImportKnowledgeSection }> = [
  { pattern: /DAFTAR\s+HARGA\s+SATUAN\s+UPAH/i, section: 'LABOR' },
  { pattern: /DAFTAR\s+HARGA\s+SATUAN\s+BAHAN/i, section: 'MATERIAL' },
  { pattern: /DAFTAR\s+HARGA\s+SEWA\s+PERALATAN/i, section: 'EQUIPMENT' },
];
const COLUMN_HEADER_MARKER = /^NO$/i;
const NAME_COLUMN = 3; // C
const CODE_COLUMN = 4; // D
const UNIT_COLUMN = 5; // E
const PRICE_COLUMN = 6; // F

/**
 * Exhaustive ExcelJS cell-value classification for plain text-shaped cells
 * (resource name/code/unit). Handles plain string, number-as-text, rich
 * text runs, formula with a string/number cached result (covers both
 * direct and shared formulas -- both expose `.result` on `cell.value` when
 * a cached result exists), and hyperlink display text. Never coerces an
 * unrecognized shape to `[object Object]` or `String(value)` -- returns
 * null instead, which surfaces as a missing field to the caller.
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
      const joined = richText.map((part) => part.text).join('').trim();
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
      return typeof hyperlinkValue.text === 'string' ? hyperlinkValue.text.trim() || null : null;
    }
    default:
      return null;
  }
}

interface PriceCellEvidence {
  cellType: number;
  numericRoundTripString: string | null;
  textValue: string | null;
  formulaText: string | null;
  cachedResultRoundTripString: string | null;
  formulaError: string | null;
  numberFormat: string | null;
  displayText: string | null;
  proposedCanonicalPrice: string | null;
  canonicalRoundingMode: string | null;
  errors: string[];
}

/**
 * Full raw-numeric-evidence classification for the price cell specifically
 * (01-RM02B0-SCHEMA-CONTRACT.md §2's OBJECT_CELL_POLICY). Every recognized
 * ExcelJS value shape is handled explicitly; anything outside the
 * enumerated set is a FUNCTIONAL_BLOCKER (errors, never a fabricated
 * canonical price). proposedCanonicalPrice is computed exclusively via
 * Prisma.Decimal.toDecimalPlaces(2, ROUND_HALF_UP) from a genuinely
 * numeric source string -- never parseFloat/Number/toFixed as authority.
 */
function classifyPriceCell(cell: ExcelJS.Cell): PriceCellEvidence {
  const cellType = cell.type;
  const numberFormat = cell.numFmt ?? null;
  const displayText = cellDisplayText(cell);
  const errors: string[] = [];

  let numericRoundTripString: string | null = null;
  let textValue: string | null = null;
  let formulaText: string | null = null;
  let cachedResultRoundTripString: string | null = null;
  let formulaError: string | null = null;

  const value = cell.value;

  switch (cellType) {
    case ExcelJS.ValueType.Number: {
      numericRoundTripString = String(value as number);
      break;
    }
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString: {
      textValue = String(value);
      errors.push('PRICE_CELL_IS_TEXT_NOT_NUMBER');
      break;
    }
    case ExcelJS.ValueType.Formula: {
      const formulaValue = value as { formula?: unknown; sharedFormula?: unknown; result?: unknown };
      if (typeof formulaValue.formula === 'string') {
        formulaText = formulaValue.formula;
      } else if (typeof formulaValue.sharedFormula === 'string') {
        // ExcelJS's `.formula`/`.result` convenience getters are unreliable
        // for shared-formula cells (confirmed empirically against the real
        // source workbook) -- the raw value object is read directly instead.
        // The formula text itself lives only on the master cell; the
        // reference is retained as honest evidence, not fabricated text.
        formulaText = `[shared-formula-ref:${formulaValue.sharedFormula}]`;
      } else {
        errors.push('UNRECOGNIZED_FORMULA_SHAPE');
      }

      const result = formulaValue.result;
      if (result === undefined) {
        errors.push('FORMULA_NO_CACHED_RESULT');
      } else if (typeof result === 'number') {
        cachedResultRoundTripString = String(result);
      } else if (typeof result === 'string') {
        errors.push('FORMULA_RESULT_IS_TEXT_NOT_NUMBER');
      } else if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
        formulaError = String((result as { error: unknown }).error);
        errors.push('FORMULA_ERROR');
      } else {
        errors.push('UNRECOGNIZED_FORMULA_RESULT_SHAPE');
      }
      break;
    }
    case ExcelJS.ValueType.Error: {
      const errorValue = value as { error?: unknown };
      formulaError = typeof errorValue.error === 'string' ? errorValue.error : 'ERROR_CELL';
      errors.push('PRICE_CELL_IS_ERROR');
      break;
    }
    case ExcelJS.ValueType.Date:
      errors.push('PRICE_CELL_IS_DATE');
      break;
    case ExcelJS.ValueType.Boolean:
      errors.push('PRICE_CELL_IS_BOOLEAN');
      break;
    case ExcelJS.ValueType.RichText:
      errors.push('PRICE_CELL_IS_RICH_TEXT');
      break;
    case ExcelJS.ValueType.Hyperlink:
      errors.push('PRICE_CELL_IS_HYPERLINK');
      break;
    case ExcelJS.ValueType.Null:
    case ExcelJS.ValueType.Merge:
      errors.push('PRICE_CELL_EMPTY');
      break;
    default:
      errors.push('UNRECOGNIZED_CELL_SHAPE');
  }

  const canonicalSourceString = numericRoundTripString ?? cachedResultRoundTripString;
  let proposedCanonicalPrice: string | null = null;
  let canonicalRoundingMode: string | null = null;
  if (canonicalSourceString !== null) {
    const decimal = new Prisma.Decimal(canonicalSourceString).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    proposedCanonicalPrice = decimal.toFixed(2);
    canonicalRoundingMode = 'ROUND_HALF_UP';
  }

  return {
    cellType,
    numericRoundTripString,
    textValue,
    formulaText,
    cachedResultRoundTripString,
    formulaError,
    numberFormat,
    displayText,
    proposedCanonicalPrice,
    canonicalRoundingMode,
    errors,
  };
}

export class BasicPriceXlsxIntakeAdapter {
  async parse(buffer: Buffer, fileName: string, selectedSheet?: string): Promise<BasicPriceImportKnowledgeObject> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    if (workbook.worksheets.length === 0) throw new Error('WORKBOOK_HAS_NO_SHEETS');
    const sheet = selectedSheet
      ? workbook.getWorksheet(selectedSheet)
      : workbook.worksheets.length === 1
        ? workbook.worksheets[0]
        : undefined;
    if (!sheet) throw new Error('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');

    if (sheet.rowCount > MAX_SOURCE_ROWS) throw new Error('SOURCE_ROW_LIMIT_EXCEEDED');

    const rows: BasicPriceImportKnowledgeRow[] = [];
    let currentSection: BasicPriceImportKnowledgeSection | null = null;
    let totalSourceRows = 0;

    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const nameCell = row.getCell(NAME_COLUMN);
      const anyCellText = [1, 2, 3, 4, 5, 6, 7]
        .map((c) => cellDisplayText(row.getCell(c)))
        .find((t) => t !== null);
      if (anyCellText === undefined) continue; // fully blank spacer row

      const marker = SECTION_MARKERS.find(({ pattern }) => pattern.test(anyCellText));
      if (marker) {
        currentSection = marker.section;
        continue; // section-title row, not a data row
      }

      const bText = cellDisplayText(row.getCell(2));
      if (bText && COLUMN_HEADER_MARKER.test(bText)) continue; // column-header row

      if (!currentSection) continue; // content before the first recognized section (workbook title block)

      totalSourceRows += 1;
      const name = cellDisplayText(nameCell);
      if (!name) continue; // no resolvable resource name -- not a real data row (matches BOQ's precedent)

      const codeCell = row.getCell(CODE_COLUMN);
      const unitCell = row.getCell(UNIT_COLUMN);
      const priceCell = row.getCell(PRICE_COLUMN);

      const code = cellDisplayText(codeCell);
      const unit = cellDisplayText(unitCell);
      const priceEvidence = classifyPriceCell(priceCell);

      const warnings: string[] = [];
      const errors: string[] = [...priceEvidence.errors];
      if (!unit) errors.push('UNIT_REQUIRED');
      if (!code) warnings.push('RESOURCE_CODE_MISSING');

      rows.push({
        sourceSection: currentSection,
        sourceRowNumber: rowNumber,
        sourceCodeCellAddress: codeCell.address,
        sourceNameCellAddress: nameCell.address,
        sourceUnitCellAddress: unitCell.address,
        sourcePriceCellAddress: priceCell.address,
        rawResourceCodeText: code,
        rawResourceNameText: name,
        rawUnitText: unit,
        rawPriceCellType: priceEvidence.cellType,
        rawPriceNumericRoundTripString: priceEvidence.numericRoundTripString,
        rawPriceTextValue: priceEvidence.textValue,
        rawPriceFormulaText: priceEvidence.formulaText,
        rawPriceCachedResultRoundTripString: priceEvidence.cachedResultRoundTripString,
        rawPriceFormulaError: priceEvidence.formulaError,
        rawPriceNumberFormat: priceEvidence.numberFormat,
        rawPriceDisplayText: priceEvidence.displayText,
        proposedCanonicalPrice: priceEvidence.proposedCanonicalPrice,
        canonicalRoundingMode: priceEvidence.canonicalRoundingMode,
        warnings,
        errors,
      });
    }

    return {
      parserContractVersion: BASIC_PRICE_PARSER_CONTRACT_VERSION,
      sourceSha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
      fileName,
      sheetName: sheet.name,
      totalSourceRows,
      rows,
    };
  }
}

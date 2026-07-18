import { createHash } from 'crypto';
import ExcelJS from 'exceljs';

export const BOQ_PARSER_CONTRACT_VERSION = 'IMPORT_FIRST_01_V2';
export const MAX_SOURCE_ROWS = 20_000;

export interface BoqImportKnowledgeRow {
  sourceRowNumber: number;
  sourceCode: string | null;
  description: string;
  quantityDecimalString: string | null;
  unitRaw: string | null;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  parentSourceReference: string | null;
  sortOrder: number;
  warnings: string[];
  errors: string[];
}

export interface BoqImportKnowledgeObject {
  parserContractVersion: string;
  sourceSha256: string;
  fileName: string;
  sheetName: string;
  totalSourceRows: number;
  rows: BoqImportKnowledgeRow[];
  sourceQuantityEvidence: {
    maxScale: number;
    rowsExceedingScale2: number;
    examples: Array<{ sourceRowNumber: number; rawValue: string; normalizedDecimal: string; scale: number }>;
  };
}

const SUMMARY = /^(jumlah|subjumlah|subtotal|total(?:\s+rab)?|profit|keuntungan|ppn|grand\s+total|rekapitulasi|terbilang)\b/i;
const ROMAN = /^[IVXLCDM]+$/i;

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('').trim();
  return String(value).trim();
}

function normalizeDecimal(raw: string): string | null {
  const value = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction] = value.split('.');
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

export class BoqXlsxIntakeAdapter {
  async parse(buffer: Buffer, fileName: string, selectedSheet?: string): Promise<BoqImportKnowledgeObject> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    if (workbook.worksheets.length === 0) throw new Error('WORKBOOK_HAS_NO_SHEETS');
    const sheet = selectedSheet ? workbook.getWorksheet(selectedSheet) : workbook.worksheets.length === 1 ? workbook.worksheets[0] : undefined;
    if (!sheet) throw new Error('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');

    const meaningful: number[] = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      if ([1, 2, 3, 4, 5, 6].some((column) => cellText(sheet.getCell(rowNumber, column)) !== '')) meaningful.push(rowNumber);
    }
    if (meaningful.length > MAX_SOURCE_ROWS) throw new Error('SOURCE_ROW_LIMIT_EXCEEDED');

    const headerRow = meaningful.find((row) => /uraian pekerjaan/i.test(cellText(sheet.getCell(row, 2))));
    if (!headerRow) throw new Error('BOQ_HEADER_NOT_FOUND');

    const rows: BoqImportKnowledgeRow[] = [];
    let activeFolder: string | null = null;
    let maxScale = 0;
    const examples: BoqImportKnowledgeObject['sourceQuantityEvidence']['examples'] = [];

    for (const sourceRowNumber of meaningful.filter((row) => row > headerRow + 1)) {
      const code = cellText(sheet.getCell(sourceRowNumber, 1));
      const description = cellText(sheet.getCell(sourceRowNumber, 2));
      const unit = cellText(sheet.getCell(sourceRowNumber, 5));
      const rawQuantity = cellText(sheet.getCell(sourceRowNumber, 6));
      if (!description || SUMMARY.test(description.trim())) continue;

      const normalizedQuantity = rawQuantity ? normalizeDecimal(rawQuantity) : null;
      const errors: string[] = [];
      const warnings: string[] = [];
      const isFolder = ROMAN.test(code) || (!unit && normalizedQuantity === null) || (!unit && rawQuantity === '0');
      const itemType: BoqImportKnowledgeRow['itemType'] = isFolder ? 'FOLDER' : 'WORK_ITEM';
      if (!isFolder && normalizedQuantity === null) errors.push('INVALID_QUANTITY');
      if (!isFolder && !unit) errors.push('UNIT_REQUIRED');

      if (normalizedQuantity) {
        const scale = normalizedQuantity.includes('.') ? normalizedQuantity.split('.')[1].length : 0;
        maxScale = Math.max(maxScale, scale);
        if (scale > 2 && examples.length < 10) examples.push({ sourceRowNumber, rawValue: rawQuantity, normalizedDecimal: normalizedQuantity, scale });
      }

      const reference = `row:${sourceRowNumber}`;
      rows.push({
        sourceRowNumber,
        sourceCode: code || null,
        description,
        quantityDecimalString: isFolder ? null : normalizedQuantity,
        unitRaw: isFolder ? null : unit || null,
        itemType,
        parentSourceReference: isFolder ? null : activeFolder,
        sortOrder: rows.length,
        warnings,
        errors,
      });
      if (isFolder) activeFolder = reference;
    }

    return {
      parserContractVersion: BOQ_PARSER_CONTRACT_VERSION,
      sourceSha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
      fileName,
      sheetName: sheet.name,
      totalSourceRows: meaningful.length,
      rows,
      sourceQuantityEvidence: { maxScale, rowsExceedingScale2: examples.length, examples },
    };
  }
}

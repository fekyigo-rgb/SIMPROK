import { createHash } from 'crypto';
import ExcelJS from 'exceljs';

export const BOQ_PARSER_CONTRACT_VERSION = 'IMPORT_FIRST_01_V4';
export const BOQ_READER_CONTRACT_VERSION = 'BOQ_XLSX_INTAKE_ADAPTER_V3';
export const MAX_SOURCE_ROWS = 20_000;

export interface BoqImportKnowledgeRow {
  sourceRowNumber: number;
  sourceCode: string | null;
  /** From an explicitly labelled AHSP reference column; never inferred. */
  sourceAhspCode?: string | null;
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


type BoqHeader = { row: number; description: number; quantity: number; unit: number; code: number | null; ahspCode: number | null };

function findBoqHeader(sheet: ExcelJS.Worksheet): BoqHeader | null {
  const headers: BoqHeader[] = [];
  sheet.eachRow((row, rowNumber) => {
    const columns = { description: [] as number[], quantity: [] as number[], unit: [] as number[], code: [] as number[], ahspCode: [] as number[] };
    row.eachCell((cell, column) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const label = cellText(cell).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:]$/, '');
      if (/^uraian(?: pekerjaan)?$/.test(label)) columns.description.push(column);
      if (/^(volume|kuantitas|quantity)$/.test(label)) columns.quantity.push(column);
      if (/^(satuan|unit)$/.test(label)) columns.unit.push(column);
      if (/^(no|nomor|kode)$/.test(label)) columns.code.push(column);
      if (/^(kode ahsp|ahsp code|referensi ahsp)$/.test(label)) columns.ahspCode.push(column);
    });
    if (!columns.description.length || !columns.quantity.length || !columns.unit.length) return;
    if (Object.values(columns).some((values) => values.length > 1)) throw new Error('BOQ_HEADER_AMBIGUOUS');
    const { description: [description], quantity: [quantity], unit: [unit], code: [code], ahspCode: [ahspCode] } = columns;
    headers.push({ row: rowNumber, description, quantity, unit,
      code: code ?? (![description, quantity, unit, ...(ahspCode ? [ahspCode] : [])].includes(1) ? 1 : null),
      ahspCode: ahspCode ?? null });
  });
  if (headers.length > 1) throw new Error('BOQ_HEADER_AMBIGUOUS');
  return headers[0] ?? null;
}

export class BoqXlsxIntakeAdapter {
  async parse(buffer: Buffer, fileName: string, selectedSheet?: string): Promise<BoqImportKnowledgeObject> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    if (workbook.worksheets.length === 0) throw new Error('WORKBOOK_HAS_NO_SHEETS');
    const selected = selectedSheet ? workbook.getWorksheet(selectedSheet) : undefined;
    if (selectedSheet && !selected) throw new Error('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');
    const candidates = (selected ? [selected] : workbook.worksheets)
      .map((sheet) => ({ sheet, header: findBoqHeader(sheet) }))
      .filter((candidate): candidate is { sheet: ExcelJS.Worksheet; header: BoqHeader } => candidate.header !== null);
    if (!candidates.length) throw new Error('BOQ_HEADER_NOT_FOUND');
    if (candidates.length !== 1) throw new Error('WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND');
    const { sheet, header } = candidates[0];
    const meaningful: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      if ([header.description, header.quantity, header.unit, ...(header.code ? [header.code] : []), ...(header.ahspCode ? [header.ahspCode] : [])]
        .some((column) => cellText(row.getCell(column)) !== '')) meaningful.push(rowNumber);
    });
    if (meaningful.length > MAX_SOURCE_ROWS) throw new Error('SOURCE_ROW_LIMIT_EXCEEDED');

    const rows: BoqImportKnowledgeRow[] = [];
    let activeFolder: string | null = null;
    let maxScale = 0;
    let rowsExceedingScale2 = 0;
    const examples: BoqImportKnowledgeObject['sourceQuantityEvidence']['examples'] = [];

    for (const sourceRowNumber of meaningful.filter((row) => row > header.row)) {
      const code = header.code ? cellText(sheet.getCell(sourceRowNumber, header.code)) : '';
      const description = cellText(sheet.getCell(sourceRowNumber, header.description));
      const sourceAhspCode = header.ahspCode ? cellText(sheet.getCell(sourceRowNumber, header.ahspCode)) : '';
      const unit = cellText(sheet.getCell(sourceRowNumber, header.unit));
      const rawQuantity = cellText(sheet.getCell(sourceRowNumber, header.quantity));
      if (!description || SUMMARY.test(description.trim())) continue;
      // Some BOQs include a column-number guide immediately below the header.
      if (sourceRowNumber === header.row + 1 &&
          [description, unit, rawQuantity].every((value) => /^\d+$/.test(value)) &&
          (!code || /^\d+$/.test(code))) continue;

      const normalizedQuantity = rawQuantity ? normalizeDecimal(rawQuantity) : null;
      const errors: string[] = [];
      const warnings: string[] = [];
      const isFolder = ROMAN.test(code) || (!unit && normalizedQuantity === null) || (!unit && rawQuantity === '0');
      const itemType: BoqImportKnowledgeRow['itemType'] = isFolder ? 'FOLDER' : 'WORK_ITEM';
      if (!isFolder && normalizedQuantity === null) errors.push('INVALID_QUANTITY');
      if (!isFolder && !unit) errors.push('UNIT_REQUIRED');
      if (sourceAhspCode.length > 128) errors.push('SOURCE_AHSP_REFERENCE_TOO_LONG');

      if (normalizedQuantity) {
        const scale = normalizedQuantity.includes('.') ? normalizedQuantity.split('.')[1].length : 0;
        maxScale = Math.max(maxScale, scale);
        if (scale > 2) {
          rowsExceedingScale2 += 1;
          if (examples.length < 10) examples.push({ sourceRowNumber, rawValue: rawQuantity, normalizedDecimal: normalizedQuantity, scale });
        }
      }

      const reference = `row:${sourceRowNumber}`;
      rows.push({
        sourceRowNumber,
        sourceCode: code || null,
        sourceAhspCode: !isFolder && sourceAhspCode ? sourceAhspCode : null,
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
      sourceQuantityEvidence: { maxScale, rowsExceedingScale2, examples },
    };
  }
}

import ExcelJS from 'exceljs';

export interface TechnicalExtractionResult {
  rawRows: unknown[];
  detectedColumns: Record<string, unknown>;
  rowCount: number;
}

export async function extractXlsxRawRows(
  bytes: Buffer,
): Promise<TechnicalExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      rawRows: [],
      detectedColumns: {
        worksheetName: null,
        headerRowIndex: null,
        columns: [],
      },
      rowCount: 0,
    };
  }

  const rawRows: unknown[] = [];
  let maxColumnCount = 0;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    maxColumnCount = Math.max(maxColumnCount, row.cellCount);
    const values: unknown[] = [];

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      values[columnNumber - 1] = toJsonValue(cell.value);
    });

    rawRows.push({
      rowNumber: row.number,
      values,
    });
  });

  const firstRow = rawRows[0] as { rowNumber?: number; values?: unknown[] } | undefined;
  const headerValues = firstRow?.values ?? [];

  return {
    rawRows,
    detectedColumns: {
      worksheetName: worksheet.name,
      headerRowIndex: firstRow?.rowNumber ?? null,
      columns: Array.from({ length: maxColumnCount }, (_, index) => ({
        columnIndex: index + 1,
        headerValue: headerValues[index] ?? null,
      })),
    },
    rowCount: rawRows.length,
  };
}

function toJsonValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item as ExcelJS.CellValue));
  }

  if (typeof value === 'object') {
    return JSON.parse(JSON.stringify(value));
  }

  return String(value);
}

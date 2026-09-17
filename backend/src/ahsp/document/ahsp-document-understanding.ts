/**
 * AHSP document understanding — USI-01 meaning slot for official AHSP
 * analisa workbooks.
 *
 * Consumes SourceTable only. Does not read XLSX bytes, does not write AHSP,
 * does not call Unit Kernel or Resource Identity, and does not clone the
 * Basic Price price-table detector. Columns are bound by header captions.
 * B1B12 column letters are not law. When a block states its output unit in more
 * than one place, only the SPELLINGS are compared here; whether two different
 * spellings name one unit is the Unit Kernel's question, asked at resolution.
 */
import {
  SourceCell,
  SourceRead,
  SourceRow,
  SourceTable,
  cellAt,
  formatLocator,
  textAt,
} from '../../universal-intake/readers/source-table';
import { SourceEnvelope } from '../../universal-intake/source-envelope';
import { foldHeader } from '../../universal-intake/structure/header-vocabulary';
import {
  AHSP_DOCUMENT_CONTRACT_VERSION,
  AHSP_DOCUMENT_REASON,
  AhspDocumentKnowledge,
  AhspDocumentReasonCode,
  AhspResourceGroup,
  AhspResourceKnowledge,
  AhspSourceLocator,
  AhspWorkItemKnowledge,
} from './ahsp-document-knowledge';

const OUTPUT_UNIT_PATTERN =
  /harga\s+satuan\s+pekerjaan\s+per\s*[-–]?\s*(.+?)\s*\(/i;
/**
 * A block that states its output unit on a row of its own, above the header:
 *
 *   B.13 Gorong-gorong pipa beton bertulang ... (2.3.(3c))
 *   satuan : m
 *   No | Komponen | | Satuan | Perkiraan Kuantitas | ...
 *
 * Read literally from that one cell. The unit is never borrowed from a
 * neighbouring block or a component's own satuan, and a title states it only in
 * the one narrow shape TITLE_QUANTITY_PATTERN reads.
 */
const UNIT_STATEMENT_PATTERN = /^satuan\s*:\s*(\S(?:.*\S)?)$/i;
/**
 * A work title that names the quantity its analysis produces states the output
 * unit: "Pemasangan 1 m2 Plesteran Dinding", "1 m3 Galian Batu", "PEKERJAAN 1 KG
 * Besi". Read only in that shape — the number is exactly 1; the unit is one of
 * these spellings, kept exactly as written for the Unit Kernel to judge; and the
 * quantity opens the title or directly follows the work noun ("Pe…an") with only
 * words before it. A dimension, a strength class, a mix or a distance ("Pipa
 * diameter 6 inch", "Beton K-250", "Campuran 1:2:3", "tebal 5 cm", "Untuk Jarak
 * 1 Km") never has that shape, and a rate or compound ("1 kg/cm2") is no output.
 * A unit ending in a letter must end the word; "1 m2Plesteran" still reads m2.
 */
const TITLE_QUANTITY_PATTERN =
  /^(?:(?:[^\s\d]+\s+)*pe\p{L}*an\s+)?1\s*(m³|m²|m3|m2|m1|m'|m’|kg|ton|buah|bh|unit|set|titik|ls|lembar|lbr|batang|btg|pasang|psg|m)(?![\d/'’])(?!(?<=\p{L})\p{L})/iu;
const AUTHORITY_PATTERN = /permen|peraturan\s+menteri|ahsp\s+pupr|pupr\s+no/i;
const SUMMARY_PATTERN =
  /jumlah\s+harga|biaya\s+umum|harga\s+satuan\s+pekerjaan|overhead/i;
/**
 * The block's closing price total, "F. HARGA SATUAN PEKERJAAN (D + E)". Once a
 * block's components have been read, it ends them: what a sheet prints below it
 * ("Nota :" and its numbered notes, the next block's title) is not a component.
 */
const CLOSING_TOTAL_PATTERN = /harga\s+satuan\s+pekerjaan/i;
/** A section letter in the No column ("A", "B.", "c."), never a sequence number. */
const SECTION_MARKER_PATTERN = /^[A-Za-z]\.?$/;
const SECTION_PATTERNS: ReadonlyArray<{
  group: AhspResourceGroup;
  pattern: RegExp;
}> = [
  { group: 'LABOR', pattern: /^(tenaga(\s+kerja)?|labor)$/ },
  { group: 'MATERIAL', pattern: /^(bahan|material)$/ },
  { group: 'EQUIPMENT', pattern: /^(peralatan|equipment)$/ },
];

type ColumnRole = 'URAIAN' | 'KODE' | 'SATUAN' | 'KOEFISIEN';

const ROLE_ALIASES: Record<ColumnRole, readonly string[]> = {
  URAIAN: ['uraian', 'uraian pekerjaan', 'komponen'],
  KODE: ['kode'],
  SATUAN: ['satuan'],
  KOEFISIEN: ['koefisien', 'koef', 'coefficient', 'perkiraan kuantitas'],
};

interface BoundColumns {
  roles: Partial<Record<ColumnRole, number>>;
  ambiguous: boolean;
}

function locatorOf(
  table: SourceTable,
  row: SourceRow,
  columnNumber: number,
  raw: string,
): AhspSourceLocator {
  return {
    sheetName: table.name,
    locator: formatLocator(table.locatorDialect, row.number, columnNumber),
    rowNumber: row.number,
    raw,
  };
}

function bindHeaderRoles(table: SourceTable, row: SourceRow): BoundColumns {
  const roles: Partial<Record<ColumnRole, number>> = {};
  let ambiguous = false;
  for (let column = 1; column <= table.columnCount; column += 1) {
    const text = textAt(row, column);
    if (!text) continue;
    const folded = foldHeader(text);
    const matched = (Object.keys(ROLE_ALIASES) as ColumnRole[]).filter((role) =>
      ROLE_ALIASES[role].includes(folded),
    );
    if (matched.length !== 1) continue;
    const role = matched[0];
    if (roles[role] !== undefined) ambiguous = true;
    else roles[role] = column;
  }
  return { roles, ambiguous };
}

function isAhspHeader(bound: BoundColumns): boolean {
  return (
    !bound.ambiguous &&
    bound.roles.URAIAN !== undefined &&
    bound.roles.SATUAN !== undefined &&
    bound.roles.KOEFISIEN !== undefined
  );
}

function isColumnNumberRow(table: SourceTable, row: SourceRow): boolean {
  let seen = 0;
  for (let column = 1; column <= table.columnCount; column += 1) {
    const text = textAt(row, column);
    if (!text) continue;
    if (!/^\d{1,2}$/.test(text)) return false;
    seen += 1;
  }
  return seen >= 3;
}

function isCurrencyBannerRow(table: SourceTable, row: SourceRow): boolean {
  const texts = row.cells
    .map((cell) => cell?.text?.trim() ?? '')
    .filter((text) => text !== '');
  return texts.length > 0 && texts.every((text) => /^\(rp\)$/i.test(text));
}

function sectionGroup(text: string | null): AhspResourceGroup | null {
  if (!text) return null;
  const folded = foldHeader(text);
  for (const entry of SECTION_PATTERNS) {
    if (entry.pattern.test(folded)) return entry.group;
  }
  return null;
}

function isSkipUraian(text: string | null): boolean {
  if (!text) return true;
  if (SUMMARY_PATTERN.test(text)) return true;
  const folded = foldHeader(text);
  if (folded === 'no' || folded === 'nota' || folded === 'catatan') return true;
  return false;
}

/** Resource code printed in the same cell as the name, separated by a wide gap. */
function splitEmbeddedResourceCode(text: string): { name: string; code: string | null } {
  const match = text.trim().match(/^(.*?)\s{2,}([A-Za-z]{1,3}\d{1,4}[A-Za-z]?)$/);
  if (!match) return { name: text.trim(), code: null };
  return { name: match[1].trim(), code: match[2] };
}

function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  if (/^\d+\s*(m3|m2|m²|kg|ls|oh)\b/i.test(trimmed)) return false;
  return /^\d+\.\d+/.test(trimmed) || /^[A-Za-z]{1,4}\s*[:.]?\s*\d/.test(trimmed);
}

function looksLikeResourceCode(text: string | null): boolean {
  if (!text) return false;
  return /^[A-Za-z]{1,3}\d{1,4}[A-Za-z]?$/.test(text.trim());
}

/**
 * One title cell that already contains a proven work code plus a remainder
 * description. Two-cell identity stays preferred; this only reads a combined
 * cell when the code token is separable. It does not invent a code.
 */
function splitCombinedWorkIdentity(
  text: string,
): { code: string; name: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\S+(?:\s+\([^)]{1,40}\))?)\s+(.{4,})$/);
  if (!match) return null;
  const code = match[1].trim();
  const name = match[2].trim();
  if (!looksLikeCode(code)) return null;
  if (looksLikeCode(name) && name.length <= 48) return null;
  return { code, name };
}

/**
 * A header with Komponen/Satuan/Perkiraan Kuantitas often leaves the resource
 * code column unlabeled. Bind it only when exactly one unlabeled column sits
 * between Uraian and Satuan — never by letter.
 */
function inferUnlabeledCodeColumn(
  table: SourceTable,
  headerRow: SourceRow,
  bound: BoundColumns,
): BoundColumns {
  if (bound.roles.KODE !== undefined) return bound;
  const uraian = bound.roles.URAIAN;
  const satuan = bound.roles.SATUAN;
  if (uraian === undefined || satuan === undefined) return bound;
  const unlabeled: number[] = [];
  const start = Math.min(uraian, satuan) + 1;
  const end = Math.max(uraian, satuan);
  const taken = new Set(Object.values(bound.roles));
  for (let column = start; column < end; column += 1) {
    if (taken.has(column)) continue;
    if (textAt(headerRow, column)) continue;
    unlabeled.push(column);
  }
  if (unlabeled.length !== 1) return bound;
  const column = unlabeled[0];
  const sample = table.rows.filter(
    (row) => row.number > headerRow.number && looksLikeResourceCode(textAt(row, column)),
  );
  if (sample.length === 0) return bound;
  return { ...bound, roles: { ...bound.roles, KODE: column } };
}

function looksLikeRegulation(text: string): boolean {
  return AUTHORITY_PATTERN.test(text) || /bidang/i.test(text);
}

function parsePositiveCoefficient(
  cell: SourceCell | null,
):
  | { ok: true; value: number; raw: string }
  | { ok: false; reason: AhspDocumentReasonCode; raw: string | null } {
  if (!cell) return { ok: false, reason: AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT, raw: null };
  const nativeRaw =
    cell.native?.numericRoundTripString ??
    cell.native?.cachedResultRoundTripString ??
    null;
  const candidate = nativeRaw ?? cell.text;
  if (candidate === null || candidate.trim() === '') {
    return { ok: false, reason: AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT, raw: null };
  }
  const raw = candidate.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return { ok: false, reason: AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT, raw };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT, raw };
  }
  return { ok: true, value, raw };
}

function uniqueReasons(
  codes: readonly AhspDocumentReasonCode[],
): AhspDocumentReasonCode[] {
  return [...new Set(codes)];
}

function readIdentity(
  table: SourceTable,
  titleRow: SourceRow,
): Pick<AhspWorkItemKnowledge, 'workType' | 'methodName' | 'regulationReference'> & {
  reasons: AhspDocumentReasonCode[];
} {
  const reasons: AhspDocumentReasonCode[] = [];
  let workType: AhspSourceLocator | null = null;
  let methodName: AhspSourceLocator | null = null;
  let regulationReference: AhspSourceLocator | null = null;
  const content: Array<{ column: number; text: string }> = [];
  for (let column = 1; column <= table.columnCount; column += 1) {
    const text = textAt(titleRow, column);
    if (!text) continue;
    if (looksLikeRegulation(text)) {
      if (!regulationReference) regulationReference = locatorOf(table, titleRow, column, text);
      continue;
    }
    content.push({ column, text });
  }
  const codeCell = content.find((cell) => looksLikeCode(cell.text) && cell.text.length <= 48);
  const nameCell = content.find(
    (cell) =>
      (!codeCell || cell.column !== codeCell.column) &&
      cell.text.trim().length > 3 &&
      !looksLikeCode(cell.text),
  );
  if (codeCell && nameCell) {
    workType = locatorOf(table, titleRow, codeCell.column, codeCell.text);
    methodName = locatorOf(table, titleRow, nameCell.column, nameCell.text);
  } else if (content.length === 1) {
    const split = splitCombinedWorkIdentity(content[0].text);
    if (split) {
      workType = locatorOf(table, titleRow, content[0].column, split.code);
      methodName = locatorOf(table, titleRow, content[0].column, split.name);
    } else {
      reasons.push(AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM);
    }
  } else {
    reasons.push(AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM);
  }
  return { workType, methodName, regulationReference, reasons };
}

/**
 * The output unit a row states, when stating it is ALL the row does: exactly one
 * non-empty cell, and that cell is a "satuan : <unit>" statement.
 */
function unitStatementOf(
  table: SourceTable,
  row: SourceRow,
): AhspSourceLocator | null {
  let statement: AhspSourceLocator | null = null;
  for (let column = 1; column <= table.columnCount; column += 1) {
    const text = textAt(row, column);
    if (!text) continue;
    if (statement) return null;
    const match = UNIT_STATEMENT_PATTERN.exec(text.trim());
    if (!match) return null;
    statement = locatorOf(table, row, column, match[1]);
  }
  return statement;
}

function findTitleRow(
  table: SourceTable,
  headerRowNumber: number,
  previousHeaderRowNumber: number,
): SourceRow | null {
  const candidates = table.rows.filter(
    (row) => row.number > previousHeaderRowNumber && row.number < headerRowNumber,
  );
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const row = candidates[index];
    if (isColumnNumberRow(table, row) || isCurrencyBannerRow(table, row)) continue;
    if (row.cells.every((cell) => !cell?.text)) continue;
    const joined = row.cells.map((cell) => cell?.text ?? '').join(' ').trim();
    if (SUMMARY_PATTERN.test(joined)) continue;
    if (sectionGroup(textAt(row, 2) ?? textAt(row, 1))) continue;
    // A unit statement sits between the title and the header; it is never the title.
    if (unitStatementOf(table, row)) continue;
    return row;
  }
  return null;
}

function readOutputUnit(
  table: SourceTable,
  rows: SourceRow[],
): AhspSourceLocator | null {
  for (const row of rows) {
    for (let column = 1; column <= table.columnCount; column += 1) {
      const text = textAt(row, column);
      if (!text) continue;
      const match = OUTPUT_UNIT_PATTERN.exec(text);
      if (!match) continue;
      const unit = match[1].trim();
      if (!unit) continue;
      return locatorOf(table, row, column, unit);
    }
  }
  return null;
}

/**
 * Every output unit a block states on its own rows between ITS title and ITS
 * header. Only that window is read, so a neighbouring block's statement — which
 * sits inside this block's body range — can never be borrowed.
 */
function readStatedOutputUnits(
  table: SourceTable,
  titleRow: SourceRow | null,
  headerRow: SourceRow,
): AhspSourceLocator[] {
  if (!titleRow) return [];
  return table.rows
    .filter(
      (row) => row.number > titleRow.number && row.number < headerRow.number,
    )
    .map((row) => unitStatementOf(table, row))
    .filter((statement): statement is AhspSourceLocator => statement !== null);
}

/** The output unit a work title states, located at the title's own cell. */
function readTitleOutputUnit(
  methodName: AhspSourceLocator | null,
): AhspSourceLocator | null {
  const match = methodName
    ? TITLE_QUANTITY_PATTERN.exec(methodName.raw.trim())
    : null;
  return methodName && match ? { ...methodName, raw: match[1] } : null;
}

/**
 * What a block's explicit statements of its output unit establish. Statements
 * with one spelling agree, and the first is used. Statements spelled DIFFERENTLY
 * are not settled here: all are kept, none is picked, and the unit is not called
 * missing — it was stated, twice. Whether "m³" and "m3" still name one unit is the
 * Unit Kernel's question, asked at resolution; this reader never decides what a
 * spelling means.
 */
function establishOutputUnit(statements: readonly AhspSourceLocator[]): {
  outputUnitRaw: AhspSourceLocator | null;
  outputUnitStatements?: readonly AhspSourceLocator[];
  reason: AhspDocumentReasonCode | null;
} {
  const spellings = new Set(
    statements.map((statement) => statement.raw.trim().toLowerCase()),
  );
  return {
    outputUnitRaw: spellings.size === 1 ? statements[0] : null,
    ...(statements.length > 1 ? { outputUnitStatements: statements } : {}),
    reason:
      spellings.size > 1
        ? AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT
        : spellings.size === 0
          ? AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT
          : null,
  };
}

/**
 * JOURNAL COMPATIBILITY — a work item kept by an earlier reader of this same
 * contract, one that did not yet read the output unit a work title states.
 *
 * The only fact such knowledge lacks is that title statement, and the title it is
 * read from was kept: `methodName`, raw and located. So THAT statement is read,
 * with the same reader, and the output unit is established with the same rule
 * from what the knowledge still holds — the one statement the earlier reader
 * agreed on, or none where it recorded MISSING_OUTPUT_UNIT. The item comes back
 * unchanged when the title states nothing, when the title statement is already
 * part of the knowledge, when the outcome would not change, and when the earlier
 * statements were never kept (a contradiction recorded without them): nothing is
 * invented. No bytes are read, and the stored knowledge is never rewritten.
 */
export function withTitleOutputUnitStatement(
  item: AhspWorkItemKnowledge,
): AhspWorkItemKnowledge {
  const title = readTitleOutputUnit(item.methodName);
  if (!title) return item;
  const isTitle = (statement: AhspSourceLocator) =>
    statement.sheetName === title.sheetName &&
    statement.locator === title.locator &&
    statement.raw === title.raw;
  if (item.outputUnitStatements) return item;
  if (item.outputUnitRaw && isTitle(item.outputUnitRaw)) return item;
  const kept = item.outputUnitRaw
    ? [item.outputUnitRaw]
    : item.reasonCodes.includes(AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT)
      ? []
      : null;
  if (kept === null) return item;
  const established = establishOutputUnit([...kept, title]);
  if (
    established.reason === null &&
    established.outputUnitRaw === item.outputUnitRaw
  ) {
    return item;
  }
  const reasonCodes = uniqueReasons([
    ...item.reasonCodes.filter(
      (code) => code !== AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
    ),
    ...(established.reason ? [established.reason] : []),
  ]);
  return {
    ...item,
    status:
      reasonCodes.length === 0 &&
      item.resources.every((resource) => resource.status === 'READY')
        ? 'READY'
        : 'UNRESOLVED',
    reasonCodes,
    outputUnitRaw: established.outputUnitRaw,
    ...(established.outputUnitStatements
      ? { outputUnitStatements: established.outputUnitStatements }
      : {}),
  };
}

function readResourceRow(
  table: SourceTable,
  row: SourceRow,
  columns: BoundColumns['roles'],
  group: AhspResourceGroup | null,
): AhspResourceKnowledge | null {
  const uraianColumn = columns.URAIAN;
  if (uraianColumn === undefined) return null;
  const uraianText = textAt(row, uraianColumn);
  const split = uraianText ? splitEmbeddedResourceCode(uraianText) : { name: null, code: null };
  const uraian = split.name;
  const codeColumn = columns.KODE;
  const unitColumn = columns.SATUAN;
  const coefficientColumn = columns.KOEFISIEN;
  const code = (codeColumn !== undefined ? textAt(row, codeColumn) : null) ?? split.code;
  const unit = unitColumn !== undefined ? textAt(row, unitColumn) : null;
  const coefficientCell =
    coefficientColumn !== undefined ? cellAt(row, coefficientColumn) : null;
  const hasName = Boolean(uraian && !isSkipUraian(uraian) && !sectionGroup(uraian));
  const parsedEarly = parsePositiveCoefficient(coefficientCell);
  if (!hasName && !parsedEarly.ok) return null;
  if (!hasName) {
    return {
      status: 'UNRESOLVED',
      reasonCodes: [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
      group,
      rawName: null,
      rawCode: code,
      rawUnit: unit,
      coefficient: parsedEarly.ok ? parsedEarly.value : null,
      nameEvidence: null,
      codeEvidence:
        code && codeColumn ? locatorOf(table, row, codeColumn, code) : null,
      unitEvidence:
        unit && unitColumn ? locatorOf(table, row, unitColumn, unit) : null,
      coefficientEvidence:
        parsedEarly.ok && coefficientColumn
          ? locatorOf(table, row, coefficientColumn, parsedEarly.raw)
          : null,
      resolvedResourceCatalogId: null,
      resolvedBaseUnit: null,
    };
  }
  const reasons: AhspDocumentReasonCode[] = [];
  if (!group) reasons.push(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);
  if (!unit) reasons.push(AHSP_DOCUMENT_REASON.MISSING_UNIT);
  const parsed = parsePositiveCoefficient(coefficientCell);
  if (!parsed.ok) reasons.push(parsed.reason);
  const nameEvidence = uraian
    ? locatorOf(table, row, uraianColumn, uraian)
    : null;
  return {
    status: reasons.length === 0 ? 'READY' : 'UNRESOLVED',
    reasonCodes: uniqueReasons(reasons),
    group,
    rawName: uraian,
    rawCode: code,
    rawUnit: unit,
    coefficient: parsed.ok ? parsed.value : null,
    nameEvidence,
    codeEvidence: code
      ? locatorOf(table, row, codeColumn ?? uraianColumn, code)
      : null,
    unitEvidence:
      unit && unitColumn ? locatorOf(table, row, unitColumn, unit) : null,
    coefficientEvidence:
      parsed.ok && coefficientColumn
        ? locatorOf(table, row, coefficientColumn, parsed.raw)
        : coefficientColumn && parsed.raw
          ? locatorOf(table, row, coefficientColumn, parsed.raw)
          : null,
    resolvedResourceCatalogId: null,
    resolvedBaseUnit: null,
  };
}

/** The header's "No" column, bound by its caption like every other column. */
function numberColumnOf(
  table: SourceTable,
  headerRow: SourceRow,
): number | null {
  const columns: number[] = [];
  for (let column = 1; column <= table.columnCount; column += 1) {
    const text = textAt(headerRow, column);
    if (text && foldHeader(text) === 'no') columns.push(column);
  }
  return columns.length === 1 ? columns[0] : null;
}

/** Whether a row states what a component states: a code, unit or quantity. */
function carriesComponentFact(
  row: SourceRow,
  columns: BoundColumns['roles'],
): boolean {
  return [columns.KODE, columns.SATUAN, columns.KOEFISIEN].some(
    (column) => column !== undefined && Boolean(textAt(row, column)?.trim()),
  );
}

function mergeContinuation(
  previous: AhspResourceKnowledge,
  next: AhspResourceKnowledge,
): AhspResourceKnowledge {
  const coefficient = previous.coefficient ?? next.coefficient;
  const reasons = uniqueReasons([
    ...previous.reasonCodes.filter((code) => code !== AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT),
    ...next.reasonCodes.filter((code) => code !== AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY),
    ...(coefficient === null ? [AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT] : []),
    ...(previous.group ? [] : [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY]),
  ]);
  return {
    ...previous,
    coefficient,
    coefficientEvidence: previous.coefficientEvidence ?? next.coefficientEvidence,
    rawUnit: previous.rawUnit ?? next.rawUnit,
    unitEvidence: previous.unitEvidence ?? next.unitEvidence,
    rawCode: previous.rawCode ?? next.rawCode,
    codeEvidence: previous.codeEvidence ?? next.codeEvidence,
    status: reasons.length === 0 ? 'READY' : 'UNRESOLVED',
    reasonCodes: reasons,
  };
}

function parseBlock(
  table: SourceTable,
  titleRow: SourceRow | null,
  headerRow: SourceRow,
  bodyRows: SourceRow[],
  columns: BoundColumns,
  documentRegulation: AhspSourceLocator | null,
): AhspWorkItemKnowledge {
  const identity = titleRow
    ? readIdentity(table, titleRow)
    : {
        workType: null,
        methodName: null,
        regulationReference: null,
        reasons: [AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM],
      };
  // Every explicit statement of the output unit, in precedence order: the summary
  // ("Harga Satuan Pekerjaan per - m3 ("), an explicit "satuan : m" row, the work
  // title ("Pemasangan 1 m2 …"), established by the one rule above.
  const bodyStatement = readOutputUnit(table, bodyRows);
  const titleStatement = readTitleOutputUnit(identity.methodName);
  const established = establishOutputUnit([
    ...(bodyStatement ? [bodyStatement] : []),
    ...readStatedOutputUnits(table, titleRow, headerRow),
    ...(titleStatement ? [titleStatement] : []),
  ]);
  const reasons: AhspDocumentReasonCode[] = [...identity.reasons];
  if (established.reason) reasons.push(established.reason);
  if (columns.ambiguous) reasons.push(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);

  const numberColumn = numberColumnOf(table, headerRow);
  let group: AhspResourceGroup | null = null;
  let closed = false;
  const resources: AhspResourceKnowledge[] = [];
  for (const row of bodyRows) {
    if (isColumnNumberRow(table, row) || isCurrencyBannerRow(table, row)) continue;
    if (closed) {
      // Nothing below the closing total is a component. A row there that still
      // states a code, unit or quantity cannot be read either way, so the item
      // is held rather than that row dropped without a word.
      if (carriesComponentFact(row, columns.roles)) {
        reasons.push(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);
      }
      continue;
    }
    const uraianColumn = columns.roles.URAIAN ?? 2;
    const uraian = textAt(row, uraianColumn) ?? textAt(row, 2) ?? textAt(row, 1);
    const nextGroup = sectionGroup(uraian);
    if (nextGroup) {
      group = nextGroup;
      continue;
    }
    if (uraian && resources.length > 0 && CLOSING_TOTAL_PATTERN.test(uraian)) {
      closed = true;
      continue;
    }
    if (isSkipUraian(uraian)) continue;
    const marker =
      numberColumn !== null ? textAt(row, numberColumn)?.trim() : null;
    if (
      marker &&
      SECTION_MARKER_PATTERN.test(marker) &&
      !carriesComponentFact(row, columns.roles)
    ) {
      // A section heading SIMPROK cannot read ("B. | BANAN"). The rows under it
      // are not filed under the previous section: they carry no group, and the
      // item is held.
      group = null;
      reasons.push(AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY);
      continue;
    }
    const resource = readResourceRow(table, row, columns.roles, group);
    if (!resource) continue;
    if (!resource.rawName) {
      const previous = resources[resources.length - 1];
      if (previous && previous.coefficient === null && resource.coefficient !== null) {
        resources[resources.length - 1] = mergeContinuation(previous, resource);
      } else {
        resources.push({
          ...resource,
          status: 'UNRESOLVED',
          reasonCodes: uniqueReasons([
            ...resource.reasonCodes,
            AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY,
          ]),
        });
      }
      continue;
    }
    resources.push(resource);
  }

  if (resources.length === 0) reasons.push(AHSP_DOCUMENT_REASON.MISSING_RESOURCE);
  if (resources.some((resource) => resource.status !== 'READY')) {
    reasons.push(...resources.flatMap((resource) => resource.reasonCodes));
  }
  const unique = uniqueReasons(reasons);
  const ready =
    unique.length === 0 && resources.every((resource) => resource.status === 'READY');
  return {
    status: ready ? 'READY' : 'UNRESOLVED',
    reasonCodes: unique,
    workType: identity.workType,
    methodName: identity.methodName,
    outputUnitRaw: established.outputUnitRaw,
    ...(established.outputUnitStatements
      ? { outputUnitStatements: established.outputUnitStatements }
      : {}),
    resolvedOutputUnit: null,
    regulationReference: identity.regulationReference ?? documentRegulation,
    effectiveDate: null,
    sheetName: table.name,
    resources,
  };
}

function parseTable(
  table: SourceTable,
  documentRegulation: AhspSourceLocator | null,
): {
  workItems: AhspWorkItemKnowledge[];
  structureReasons: AhspDocumentReasonCode[];
} {
  const headerHits: Array<{ row: SourceRow; bound: BoundColumns }> = [];
  for (const row of table.rows) {
    const bound = bindHeaderRoles(table, row);
    if (bound.ambiguous && bound.roles.URAIAN && bound.roles.KOEFISIEN) {
      return {
        workItems: [],
        structureReasons: [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
      };
    }
    if (isAhspHeader(bound)) {
      headerHits.push({
        row,
        bound: inferUnlabeledCodeColumn(table, row, bound),
      });
    }
  }
  if (headerHits.length === 0) {
    return {
      workItems: [],
      structureReasons: [AHSP_DOCUMENT_REASON.STRUCTURE_UNSUPPORTED],
    };
  }
  const workItems: AhspWorkItemKnowledge[] = [];
  for (let index = 0; index < headerHits.length; index += 1) {
    const current = headerHits[index];
    const nextHeaderNumber =
      headerHits[index + 1]?.row.number ?? Number.POSITIVE_INFINITY;
    const previousHeaderNumber = index === 0 ? 0 : headerHits[index - 1].row.number;
    const titleRow = findTitleRow(table, current.row.number, previousHeaderNumber);
    const bodyRows = table.rows.filter(
      (row) => row.number > current.row.number && row.number < nextHeaderNumber,
    );
    workItems.push(
      parseBlock(
        table,
        titleRow,
        current.row,
        bodyRows,
        current.bound,
        documentRegulation,
      ),
    );
  }
  const seen = new Map<string, AhspWorkItemKnowledge[]>();
  for (const item of workItems) {
    if (!item.workType || !item.methodName) continue;
    const key = `${item.workType.raw}\u0000${item.methodName.raw}`;
    const list = seen.get(key) ?? [];
    list.push(item);
    seen.set(key, list);
  }
  const duplicates = new Set<AhspWorkItemKnowledge>();
  for (const list of seen.values()) {
    if (list.length > 1) list.forEach((item) => duplicates.add(item));
  }
  return {
    workItems: workItems.map((item) =>
      duplicates.has(item)
        ? {
            ...item,
            status: 'UNRESOLVED',
            reasonCodes: uniqueReasons([
              ...item.reasonCodes,
              AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY,
            ]),
          }
        : item,
    ),
    structureReasons: [],
  };
}

function documentMeta(table: SourceTable): {
  title: AhspSourceLocator | null;
  regulationReference: AhspSourceLocator | null;
} {
  let title: AhspSourceLocator | null = null;
  let regulationReference: AhspSourceLocator | null = null;
  for (const row of table.rows.slice(0, 8)) {
    for (let column = 1; column <= table.columnCount; column += 1) {
      const text = textAt(row, column);
      if (!text) continue;
      if (!title && /analisa\s+harga/i.test(text)) {
        title = locatorOf(table, row, column, text);
      }
      if (!regulationReference && AUTHORITY_PATTERN.test(text)) {
        regulationReference = locatorOf(table, row, column, text);
      }
    }
  }
  return { title, regulationReference };
}

export function understandAhspDocument(
  read: SourceRead,
  envelope: SourceEnvelope,
): AhspDocumentKnowledge {
  const source = {
    fileName: envelope.fileName,
    contentDigestSha256: envelope.contentDigestSha256,
    readerId: read.readerId,
    readerContractVersion: read.readerContractVersion,
    byteSize: envelope.byteSize,
  };
  const provenTables = read.tables.filter((table) =>
    table.rows.some((row) => isAhspHeader(bindHeaderRoles(table, row))),
  );
  if (provenTables.length === 0) {
    return {
      contractVersion: AHSP_DOCUMENT_CONTRACT_VERSION,
      source,
      document: {
        title: null,
        regulationReference: null,
        effectiveDate: null,
        authorityProven: false,
      },
      status: 'STRUCTURE_UNSUPPORTED',
      reasonCodes: [AHSP_DOCUMENT_REASON.STRUCTURE_UNSUPPORTED],
      workItems: [],
    };
  }
  const meta = documentMeta(provenTables[0]);
  const workItems: AhspWorkItemKnowledge[] = [];
  const structureReasons: AhspDocumentReasonCode[] = [];
  for (const table of provenTables) {
    const parsed = parseTable(table, meta.regulationReference);
    structureReasons.push(...parsed.structureReasons);
    workItems.push(...parsed.workItems);
  }
  const authorityProven = meta.regulationReference !== null;
  const reasonCodes = uniqueReasons([
    ...structureReasons,
    ...(authorityProven ? [] : [AHSP_DOCUMENT_REASON.AUTHORITY_UNPROVEN]),
    AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN,
  ]);
  const structuralBlock =
    workItems.length === 0 && structureReasons.includes(AHSP_DOCUMENT_REASON.STRUCTURE_UNSUPPORTED);
  return {
    contractVersion: AHSP_DOCUMENT_CONTRACT_VERSION,
    source,
    document: {
      title: meta.title,
      regulationReference: meta.regulationReference,
      effectiveDate: null,
      authorityProven,
    },
    status: structuralBlock
      ? 'STRUCTURE_UNSUPPORTED'
      : workItems.some((item) => item.status === 'READY')
        ? 'READY'
        : 'UNRESOLVED',
    reasonCodes,
    workItems,
  };
}

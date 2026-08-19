import { SourceRow, SourceTable, textAt } from '../readers/source-table';
import { ColumnRole, matchHeaderRole } from './header-vocabulary';
import { interpretPriceLiteral } from './price-literal';

/**
 * USI-01 §5 — STRUCTURE DETECTION. FORMAT != TABLE SHAPE.
 *
 * Nothing in this file knows or cares whether the grid came from a workbook or
 * a text file. It is handed a `SourceTable` and answers one question from
 * evidence alone: WHAT SHAPE OF PRICE TABLE, IF ANY, IS THIS?
 *
 * The three rules that keep it honest:
 *   - No filename is ever consulted, and no sheet name is ever required.
 *   - Exactly one proven shape is automatic; more than one asks a human ONCE;
 *     none is a precise "SIMPROK does not recognize a price table here".
 *   - There is no first-sheet fallback. A table is chosen because it PROVED
 *     something, never because it happened to be first.
 */

export type PriceTableStructure =
  | 'SECTIONED_PRICE_LIST'
  | 'SEMANTIC_HEADER_TABLE'
  | 'REGIONAL_MATRIX';

export type BasicPriceSection = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

/**
 * A sectioned price list DECLARES its own organization with full-row titles.
 * These three markers are evidence-derived from the reconfirmed real source
 * workbook (`data/first-real-input/BASIC PRICE(1).xlsx`).
 */
export const SECTION_MARKERS: ReadonlyArray<{
  pattern: RegExp;
  section: BasicPriceSection;
}> = [
  { pattern: /DAFTAR\s+HARGA\s+SATUAN\s+UPAH/i, section: 'LABOR' },
  { pattern: /DAFTAR\s+HARGA\s+SATUAN\s+BAHAN/i, section: 'MATERIAL' },
  { pattern: /DAFTAR\s+HARGA\s+SEWA\s+PERALATAN/i, section: 'EQUIPMENT' },
];

/** How far into a table a header row may hide behind title/preamble rows. */
export const HEADER_SCAN_ROWS = 50;
/** How many data rows are sampled when judging whether a column holds numbers. */
export const COLUMN_PROFILE_SAMPLE_ROWS = 50;
/** A column must be this numeric, over at least two values, to be a price-like column. */
export const NUMERIC_COLUMN_THRESHOLD = 0.6;

export interface DetectedColumn {
  columnNumber: number;
  /** The source's own words, verbatim (LAW 6). */
  headerText: string;
  role: ColumnRole | null;
}

/**
 * One jurisdiction this source can be scoped to. A Basic Price batch is
 * region-scoped, so exactly one of these becomes a batch — never all of them
 * flattened into one geography-less fact (§8).
 */
export interface RegionScopeChoice {
  /**
   * COLUMN     the jurisdiction is a column header, and its column holds that
   *            jurisdiction's prices (a regional matrix).
   * ROW_VALUE  the jurisdiction is stated per row in a region column, and the
   *            price column is shared (a flat table with a Region column).
   */
  kind: 'COLUMN' | 'ROW_VALUE';
  /** Verbatim source label. SIMPROK never maps this to a canonical Region itself. */
  label: string;
  /** The price column (COLUMN) or the label column (ROW_VALUE). */
  columnNumber: number;
  observedRowCount: number;
}

/**
 * USI-01R2 §10 — A COLUMN A HUMAN MUST NAME.
 *
 * Real scanned price lists routinely head their jurisdiction columns and leave
 * the resource and unit columns with no header at all. SIMPROK can prove which
 * columns hold the prices (they are the parallel numeric ones), but nothing in
 * such a file proves which of the remaining text columns is the resource name.
 *
 * Guessing by "longest text" or "most distinct values" would be statistics
 * dressed as evidence. So the candidates are offered, with real sample values,
 * and a person decides once.
 */
export interface ColumnRoleCandidate {
  columnNumber: number;
  /** The column's header text, when it has one at all. */
  headerText: string | null;
  nonEmptyRows: number;
  distinctValues: number;
  /** Real values from the source, so the human is choosing from evidence. */
  samples: string[];
}

export interface DetectedStructure {
  structure: PriceTableStructure;
  tableName: string;
  headerRowNumber: number | null;
  columns: DetectedColumn[];
  roleColumns: Partial<Record<ColumnRole, number>>;
  firstDataRowNumber: number | null;
  /** Physical rows below the header/first section that could carry a resource. */
  dataRowCount: number;
  regionScope: {
    required: boolean;
    kind: 'COLUMN' | 'ROW_VALUE' | null;
    choices: RegionScopeChoice[];
  };
  /**
   * Set when the table proved its shape but NOT which column carries the
   * resource name / unit. The caller must supply them before any candidate is
   * produced; SIMPROK will not pick.
   */
  columnRoles: {
    required: boolean;
    nameCandidates: ColumnRoleCandidate[];
    unitCandidates: ColumnRoleCandidate[];
  };
  /** Why SIMPROK believes this, in named signals a human can audit. */
  evidence: string[];
}

export interface TableDetection {
  tableName: string;
  candidates: DetectedStructure[];
  /** Named reasons a shape was considered and rejected — §17's raw material. */
  rejections: string[];
}

export function sectionOfMarkerText(text: string): BasicPriceSection | null {
  return SECTION_MARKERS.find(({ pattern }) => pattern.test(text))?.section ?? null;
}

/** The first non-null trimmed text across columns 1..limit of a row. */
function firstText(row: SourceRow, limit: number): string | undefined {
  for (let column = 1; column <= limit; column += 1) {
    const text = textAt(row, column);
    if (text !== null) return text;
  }
  return undefined;
}

function detectSectioned(table: SourceTable): DetectedStructure | null {
  let firstMarkerRow: number | null = null;
  let firstDataRowNumber: number | null = null;
  let dataRowCount = 0;
  const sectionsFound = new Set<BasicPriceSection>();

  for (const row of table.rows) {
    const anyText = firstText(row, Math.min(table.columnCount, 7));
    if (anyText === undefined) continue;
    const section = sectionOfMarkerText(anyText);
    if (section) {
      sectionsFound.add(section);
      if (firstMarkerRow === null) firstMarkerRow = row.number;
      continue;
    }
    if (firstMarkerRow === null) continue;
    const columnB = textAt(row, 2);
    if (columnB && /^NO$/i.test(columnB)) continue;
    dataRowCount += 1;
    if (firstDataRowNumber === null) firstDataRowNumber = row.number;
  }

  if (sectionsFound.size === 0) return null;

  return {
    structure: 'SECTIONED_PRICE_LIST',
    tableName: table.name,
    headerRowNumber: null,
    columns: [],
    // The layout this document family shares: B=no, C=name, D=code, E=unit,
    // F=price, G=notes. It is stated here rather than rediscovered per file,
    // because the SECTION TITLES are what prove the family.
    roleColumns: {
      ROW_NUMBER: 2,
      RESOURCE_NAME: 3,
      RESOURCE_CODE: 4,
      SOURCE_UNIT: 5,
      PRICE: 6,
    },
    firstDataRowNumber,
    dataRowCount,
    regionScope: { required: false, kind: null, choices: [] },
    columnRoles: { required: false, nameCandidates: [], unitCandidates: [] },
    evidence: [
      `SECTION_TITLES_PRESENT:${[...sectionsFound].sort().join(',')}`,
      `SECTION_COUNT:${sectionsFound.size}`,
    ],
  };
}

interface ColumnProfile {
  nonEmpty: number;
  numericShaped: number;
}

function profileColumn(
  table: SourceTable,
  columnNumber: number,
  dataRows: SourceRow[],
): ColumnProfile {
  let nonEmpty = 0;
  let numericShaped = 0;
  for (const row of dataRows) {
    const cell = row.cells[columnNumber - 1] ?? null;
    if (!cell || cell.text === null) continue;
    nonEmpty += 1;
    if (cell.native && cell.native.numericRoundTripString !== null) {
      numericShaped += 1;
      continue;
    }
    if (cell.native && cell.native.cachedResultRoundTripString !== null) {
      numericShaped += 1;
      continue;
    }
    // AMBIGUOUS counts as numeric SHAPE. Whether the value can be believed is a
    // different question, answered later and never by the detector (LAW 4).
    const reading = interpretPriceLiteral(cell.text);
    if (reading.outcome === 'NUMERIC' || reading.outcome === 'AMBIGUOUS') {
      numericShaped += 1;
    }
  }
  return { nonEmpty, numericShaped };
}

/** Describes a column from its actual values, for a human to choose from. */
function profileRoleCandidate(
  columnNumber: number,
  headerText: string | null,
  dataRows: SourceRow[],
): ColumnRoleCandidate {
  const values: string[] = [];
  const distinct = new Set<string>();
  for (const row of dataRows) {
    const text = textAt(row, columnNumber);
    if (text === null) continue;
    distinct.add(text);
    if (values.length < 4) values.push(text);
  }
  return {
    columnNumber,
    headerText,
    nonEmptyRows: distinct.size === 0 ? 0 : dataRows.filter((r) => textAt(r, columnNumber) !== null).length,
    distinctValues: distinct.size,
    samples: values,
  };
}

function isNumericColumn(profile: ColumnProfile): boolean {
  return (
    profile.nonEmpty >= 2 &&
    profile.numericShaped / profile.nonEmpty >= NUMERIC_COLUMN_THRESHOLD
  );
}

/**
 * The roles a structure actually READS FROM. Duplication in one of these is a
 * genuine ambiguity in the source; duplication anywhere else is not.
 */
const LOAD_BEARING_ROLES = new Set<ColumnRole>([
  'RESOURCE_NAME',
  'RESOURCE_CODE',
  'SOURCE_UNIT',
  'SIMPROK_UNIT_CANDIDATE',
  'REGION_LABEL',
  'CATEGORY_CODE',
  'CATEGORY_NAME',
]);

interface HeaderReading {
  rowNumber: number;
  columns: DetectedColumn[];
  roleColumns: Partial<Record<ColumnRole, number>>;
  duplicatedRoles: ColumnRole[];
  priceColumns: number[];
  unlabelledColumns: number[];
}

function readHeaderRow(row: SourceRow, columnCount: number): HeaderReading {
  const columns: DetectedColumn[] = [];
  const seen = new Map<ColumnRole, number[]>();
  const priceColumns: number[] = [];
  const unlabelledColumns: number[] = [];

  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const text = textAt(row, columnNumber);
    if (text === null) continue;
    const role = matchHeaderRole(text);
    columns.push({ columnNumber, headerText: text, role });
    if (role === null) {
      unlabelledColumns.push(columnNumber);
      continue;
    }
    if (role === 'PRICE') priceColumns.push(columnNumber);
    seen.set(role, [...(seen.get(role) ?? []), columnNumber]);
  }

  const roleColumns: Partial<Record<ColumnRole, number>> = {};
  const duplicatedRoles: ColumnRole[] = [];
  for (const [role, occurrences] of seen) {
    roleColumns[role] = occurrences[0];
    // Only a LOAD-BEARING role can be ambiguous. Two columns both claiming to
    // be "the unit" is a question SIMPROK cannot answer; two columns of notes
    // is just a table with two notes columns, and PRICE duplication is counted
    // separately because more than one price column is what distinguishes a
    // matrix from a flat table rather than a defect.
    if (occurrences.length > 1 && LOAD_BEARING_ROLES.has(role)) {
      duplicatedRoles.push(role);
    }
  }

  return {
    rowNumber: row.number,
    columns,
    roleColumns,
    duplicatedRoles,
    priceColumns,
    unlabelledColumns,
  };
}

function detectHeaderStructures(table: SourceTable): {
  candidates: DetectedStructure[];
  rejections: string[];
} {
  const rejections: string[] = [];
  const scanRows = table.rows.slice(0, HEADER_SCAN_ROWS);

  // The header is the EARLIEST row that recognizes the most distinct roles.
  // Earliest-wins is what makes the choice a function of the bytes: a later row
  // has to be strictly better to displace one already found.
  let best: HeaderReading | null = null;
  let bestScore = 0;
  for (const row of scanRows) {
    const reading = readHeaderRow(row, table.columnCount);
    const score = Object.keys(reading.roleColumns).length;
    if (score > bestScore) {
      best = reading;
      bestScore = score;
    }
  }

  if (!best || best.roleColumns.RESOURCE_NAME === undefined) {
    rejections.push('NO_HEADER_ROW_WITH_A_RESOURCE_NAME_COLUMN');
    return { candidates: [], rejections };
  }
  if (
    best.roleColumns.SOURCE_UNIT === undefined &&
    best.roleColumns.SIMPROK_UNIT_CANDIDATE === undefined
  ) {
    // A Basic Price row without a unit can never resolve — the Unit Kernel has
    // nothing to read and the row would sit UNIT_REQUIRED forever. A table with
    // no unit column at all is therefore not a proven Basic Price table, and
    // saying so is kinder and truer than importing hundreds of dead rows.
    rejections.push('NO_UNIT_COLUMN');
    return { candidates: [], rejections };
  }
  if (best.duplicatedRoles.length > 0) {
    // Two columns both claiming to be "the unit" is a genuine ambiguity in the
    // source, not something to resolve by taking the leftmost.
    rejections.push(`HEADER_ROLE_DUPLICATED:${best.duplicatedRoles.sort().join(',')}`);
    return { candidates: [], rejections };
  }

  const dataRows = table.rows.filter((row) => row.number > best!.rowNumber);
  const sample = dataRows.slice(0, COLUMN_PROFILE_SAMPLE_ROWS);
  const firstDataRowNumber = dataRows.length > 0 ? dataRows[0].number : null;

  const numericUnlabelled = best.unlabelledColumns.filter((columnNumber) =>
    isNumericColumn(profileColumn(table, columnNumber, sample)),
  );

  const candidates: DetectedStructure[] = [];
  const baseColumns = best.columns;

  if (best.priceColumns.length === 1) {
    const regionLabelColumn = best.roleColumns.REGION_LABEL ?? null;
    const choices: RegionScopeChoice[] = [];
    if (regionLabelColumn !== null) {
      const counts = new Map<string, number>();
      for (const row of dataRows) {
        const label = textAt(row, regionLabelColumn);
        if (label === null) continue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      for (const [label, observedRowCount] of counts) {
        choices.push({
          kind: 'ROW_VALUE',
          label,
          columnNumber: regionLabelColumn,
          observedRowCount,
        });
      }
      choices.sort((left, right) => left.label.localeCompare(right.label));
    }

    candidates.push({
      structure: 'SEMANTIC_HEADER_TABLE',
      tableName: table.name,
      headerRowNumber: best.rowNumber,
      columns: baseColumns,
      roleColumns: best.roleColumns,
      firstDataRowNumber,
      dataRowCount: dataRows.length,
      regionScope: {
        required: choices.length > 1,
        kind: choices.length > 0 ? 'ROW_VALUE' : null,
        choices,
      },
      columnRoles: { required: false, nameCandidates: [], unitCandidates: [] },
      evidence: [
        'SINGLE_PRICE_ROLE_COLUMN',
        `ROLES:${Object.keys(best.roleColumns).sort().join(',')}`,
      ],
    });
  } else if (best.priceColumns.length > 1) {
    rejections.push(`MULTIPLE_PRICE_ROLE_COLUMNS:${best.priceColumns.length}`);
  }

  if (best.priceColumns.length === 0 && numericUnlabelled.length >= 2) {
    const choices: RegionScopeChoice[] = numericUnlabelled.map((columnNumber) => ({
      kind: 'COLUMN' as const,
      label: baseColumns.find((c) => c.columnNumber === columnNumber)!.headerText,
      columnNumber,
      observedRowCount: profileColumn(table, columnNumber, dataRows).nonEmpty,
    }));

    candidates.push({
      structure: 'REGIONAL_MATRIX',
      tableName: table.name,
      headerRowNumber: best.rowNumber,
      columns: baseColumns,
      roleColumns: best.roleColumns,
      firstDataRowNumber,
      dataRowCount: dataRows.length,
      // ALWAYS required. One source row here states several jurisdictions'
      // prices, and a batch may carry exactly one of them (§8).
      regionScope: { required: true, kind: 'COLUMN', choices },
      columnRoles: { required: false, nameCandidates: [], unitCandidates: [] },
      evidence: [
        `PARALLEL_NUMERIC_COLUMNS:${numericUnlabelled.length}`,
        'NO_PRICE_ROLE_COLUMN',
        `ROLES:${Object.keys(best.roleColumns).sort().join(',')}`,
      ],
    });
  } else if (best.priceColumns.length === 0) {
    rejections.push(
      `NO_PRICE_ROLE_COLUMN_AND_PARALLEL_NUMERIC_COLUMNS:${numericUnlabelled.length}`,
    );
  }

  return { candidates, rejections };
}

/**
 * USI-01R2 §10 — A REGIONAL MATRIX WHOSE NAME/UNIT COLUMNS HAVE NO HEADER.
 *
 * The Owner's real Ambon price list is exactly this: a "KECAMATAN" banner over
 * three named jurisdiction columns, and no header whatsoever on the resource
 * and unit columns beside them. The jurisdictions are PROVEN — they are the
 * parallel numeric columns under distinct labels — so the table's shape is not
 * in doubt. Which text column is the resource name is genuinely not stated, and
 * SIMPROK asks instead of inferring.
 */
function detectUnheadedRegionalMatrix(table: SourceTable): DetectedStructure | null {
  const scanRows = table.rows.slice(0, HEADER_SCAN_ROWS);

  let best: { rowNumber: number; labels: DetectedColumn[] } | null = null;
  let rowNumberColumn: number | null = null;
  for (const row of scanRows) {
    const labelled: DetectedColumn[] = [];
    for (let columnNumber = 1; columnNumber <= table.columnCount; columnNumber += 1) {
      const text = textAt(row, columnNumber);
      if (text === null) continue;
      if (matchHeaderRole(text) !== null) continue; // a role word is not a jurisdiction
      // A scanned header often merges several column titles into one cell
      // ("No     URAIAN BAHAN"). Its LEADING word still states what that column
      // is, and a numbering column is never a jurisdiction — however numeric
      // its values happen to look.
      //
      // It is REMEMBERED rather than merely skipped: a row that the document
      // itself numbered is a row the document counts as an item, which is real
      // evidence when classifying headings later.
      if (matchHeaderRole(text.trim().split(/\s+/)[0]) === 'ROW_NUMBER') {
        rowNumberColumn = rowNumberColumn ?? columnNumber;
        continue;
      }
      // A JURISDICTION IS NAMED, NOT NUMBERED. Without this, a data row of
      // prices ("1", "340000", "314000") reads as four distinct labels over
      // four numeric columns and impersonates the banner it sits beneath.
      if (interpretPriceLiteral(text).outcome !== 'NOT_NUMERIC') continue;
      labelled.push({ columnNumber, headerText: text, role: null });
    }
    // Distinct labels only: a merged banner repeats one word across its span
    // and says nothing about individual columns.
    const distinct = new Set(labelled.map((c) => c.headerText));
    if (labelled.length >= 2 && distinct.size === labelled.length) {
      const dataRows = table.rows.filter((r) => r.number > row.number);
      const sample = dataRows.slice(0, COLUMN_PROFILE_SAMPLE_ROWS);
      const numeric = labelled.filter((c) =>
        isNumericColumn(profileColumn(table, c.columnNumber, sample)),
      );
      // EARLIEST WINS. The banner is above its data by definition, so the first
      // row that qualifies is the header and everything below it is content.
      // Preferring the WIDEST row instead would let a particularly full data
      // row outrank the real header.
      if (numeric.length >= 2 && best === null) {
        best = { rowNumber: row.number, labels: numeric };
      }
    }
  }

  if (!best) return null;

  const dataRows = table.rows.filter((r) => r.number > best!.rowNumber);
  const sample = dataRows.slice(0, COLUMN_PROFILE_SAMPLE_ROWS);
  const regionColumns = new Set(best.labels.map((c) => c.columnNumber));

  // Every column that is NOT a jurisdiction and NOT predominantly numeric is a
  // plausible name or unit column. They are offered, never chosen.
  const candidates: ColumnRoleCandidate[] = [];
  for (let columnNumber = 1; columnNumber <= table.columnCount; columnNumber += 1) {
    if (regionColumns.has(columnNumber)) continue;
    const profile = profileColumn(table, columnNumber, sample);
    if (profile.nonEmpty === 0) continue;
    if (isNumericColumn(profile)) continue; // a row-number column, not a name
    candidates.push(
      profileRoleCandidate(columnNumber, null, dataRows),
    );
  }
  if (candidates.length === 0) return null;

  return {
    structure: 'REGIONAL_MATRIX',
    tableName: table.name,
    headerRowNumber: best.rowNumber,
    columns: best.labels,
    roleColumns: rowNumberColumn === null ? {} : { ROW_NUMBER: rowNumberColumn },
    firstDataRowNumber: dataRows.length > 0 ? dataRows[0].number : null,
    dataRowCount: dataRows.length,
    regionScope: {
      required: true,
      kind: 'COLUMN',
      choices: best.labels.map((c) => ({
        kind: 'COLUMN' as const,
        label: c.headerText,
        columnNumber: c.columnNumber,
        observedRowCount: profileColumn(table, c.columnNumber, dataRows).nonEmpty,
      })),
    },
    columnRoles: {
      required: true,
      nameCandidates: candidates,
      unitCandidates: candidates,
    },
    evidence: [
      `PARALLEL_NUMERIC_COLUMNS:${best.labels.length}`,
      'NO_HEADER_ON_RESOURCE_OR_UNIT_COLUMN',
    ],
  };
}



/**
 * Detects every price-table shape a single table can prove.
 *
 * PRECEDENCE: a table whose rows DECLARE their own sections ("DAFTAR HARGA
 * SATUAN UPAH") is a sectioned price list and nothing else is offered for it.
 * That is not a tie-break of convenience — a document that states its own
 * organization is the most specific evidence available, and it strictly
 * outranks a bare header row, whose column words such a document also happens
 * to contain.
 */
export function detectTableStructures(table: SourceTable): TableDetection {
  const sectioned = detectSectioned(table);
  if (sectioned) {
    return { tableName: table.name, candidates: [sectioned], rejections: [] };
  }
  const { candidates, rejections } = detectHeaderStructures(table);
  if (candidates.length > 0) return { tableName: table.name, candidates, rejections };

  // LAST, and only when a proper header row proved nothing: a jurisdiction
  // banner with unheaded resource/unit columns. It is tried last so it can
  // never shadow a table that DOES name its columns.
  const unheaded = detectUnheadedRegionalMatrix(table);
  if (unheaded) return { tableName: table.name, candidates: [unheaded], rejections };

  return { tableName: table.name, candidates, rejections };
}

export function detectSourceStructures(tables: SourceTable[]): TableDetection[] {
  return tables.map(detectTableStructures);
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import JSZip from 'jszip';

/**
 * TEST_FIXTURE_ONLY — the Owner's Golden B1-B12 evidence, read verbatim.
 *
 * OWNER_BROWSER_FIXTURE_B1B12_20260813_v1
 * TEST_FIXTURE_ONLY · OWNER_BROWSER_VERIFICATION · NON_PRODUCTION_PROJECT_QUANTITY
 *
 * This module NEVER reaches production code. It exists so the browser-bridge
 * acceptance can materialise the section from the SAME bytes the B1-B12 unit
 * coverage proof reads, instead of a hand-retyped copy — a retyped copy is how
 * a fixture and its evidence drift apart in silence.
 *
 * ABSENT vs INVALID ARE NOT THE SAME THING (identical law to
 * b1b12-golden-unit-coverage.spec.ts):
 *   B1B12_GOLDEN_WORKBOOK_PATH unset → nobody asked for Golden acceptance.
 *                                      `isRequested()` is false; the caller
 *                                      skips, visibly and by name.
 *   B1B12_GOLDEN_WORKBOOK_PATH set   → they DID ask. A missing file, the wrong
 *                                      file, or the right name with wrong
 *                                      bytes is a FAILURE, never a skip.
 *
 * The workbook is Owner evidence, not source: it is never committed, and this
 * file carries NO machine-specific path.
 *
 * NOTE ON THE READER: ExcelJS — the parser this repository already owns —
 * cannot read this particular file (it writes OOXML with `x:`-prefixed
 * elements, which ExcelJS v4 does not resolve). The minimal namespace-agnostic
 * reader below is therefore duplicated from the landed b1b12 unit-coverage
 * spec rather than imported: that spec is a closed PASS artifact whose whole
 * point is to be self-contained, and perturbing it to share code would put a
 * settled proof at risk for no browser-bridge benefit. Consolidating the two
 * readers is a separate, safe cleanup. Neither is, or may become, a production
 * parser.
 */

const GOLDEN_SHA256 =
  '3e8393a7e9f730eb7aa7dc50c0fd50603c9912148d1dd6c566f662cf6e5023ff';
const GOLDEN_SIZE = 59451;

export const GOLDEN_FIXTURE_ID = 'OWNER_BROWSER_FIXTURE_B1B12_20260813_v1';

/**
 * Which reader produced a sighting. ResourceSourceIdentity requires it so a
 * provenance row can never be mistaken for the output of a different parser
 * with different column semantics. This one is test-only and says so.
 */
export const GOLDEN_PARSER_CONTRACT_VERSION =
  'B1B12_GOLDEN_TEST_FIXTURE_READER_V1';

/** 02_RESOURCE_MATRIX column letters, so cell addresses are facts. */
export const MATRIX_COLUMN = {
  rawResourceText: 'E',
  resourceCode: 'F',
  rawUnit: 'H',
} as const;
export const GOLDEN_FIXTURE_LABELS =
  'TEST_FIXTURE_ONLY OWNER_BROWSER_VERIFICATION NON_PRODUCTION_PROJECT_QUANTITY';

/**
 * Owner-authorised verification quantities. These are deliberately Owner test
 * quantities and are NOT claimed as field/project quantities — 08_BOQ_SECTION
 * of the pack itself records every quantity as "NOT PROVIDED". The fixture adds
 * QUANTITY ONLY; it rewrites no description, no unit, no coefficient and no
 * price.
 */
export const OWNER_FIXTURE_QUANTITY: Readonly<Record<string, string>> = {
  B1: '96.50',
  B2: '42.75',
  B3: '24.00',
  B4: '32.50',
  B5: '18.00',
  B6: '14.00',
  B7: '27.50',
  B8: '16.00',
  B9: '6.00',
  B10: '8.00',
  B11: '10.00',
  B12: '5.00',
};

/** TENAGA/BAHAN/PERALATAN as the pack writes them → Prisma ResourceType. */
export const GROUP_RESOURCE_TYPE: Readonly<Record<string, string>> = {
  TENAGA: 'LABOR',
  BAHAN: 'MATERIAL',
  PERALATAN: 'EQUIPMENT',
};

export interface GoldenAhspItem {
  /** "B1" … "B12" — the pack's own item key. */
  readonly item: string;
  /** Official AHSP code, e.g. "2.1.(1)". */
  readonly code: string;
  readonly officialDescription: string;
  /** Regulation prose, e.g. "Meter Kubik". Description, not unit notation. */
  readonly officialUnit: string;
  /** The unit token an AHSP version actually carries: "m3" or "m". */
  readonly canonicalUnit: string;
  readonly transcriptionStatus: string;
  readonly goldenPackStatus: string;
}

export interface GoldenResourceRow {
  readonly item: string;
  readonly ahspCode: string;
  readonly group: string;
  readonly resourceType: string;
  /** Column E — the source text, byte-for-byte. Evidence. */
  readonly rawResourceText: string;
  /** Column F — source resource code, "" when the source carries none. */
  readonly resourceCode: string;
  /** Column G — the pack's canonical candidate for this resource. */
  readonly canonicalCandidate: string;
  /** Column H — the source's own unit spelling. Evidence. */
  readonly rawUnit: string;
  readonly canonicalUnit: string;
  /** Column K — numeric coefficient. */
  readonly coefficient: string;
  /** Column L — published unit price for this resource. */
  readonly publishedUnitPrice: string;
  /** Workbook row number, for provenance. */
  readonly sourceRow: number;
}

export interface GoldenEvidence {
  readonly path: string;
  /** Basename of the file actually read — provenance, not a constant. */
  readonly fileName: string;
  readonly sha256: string;
  readonly size: number;
  readonly items: ReadonlyArray<GoldenAhspItem>;
  readonly resources: ReadonlyArray<GoldenResourceRow>;
  /**
   * 04_PUBLISHED_SUMMARY "Oracle D" — the pack's OWN independent recalculation
   * of each analysis's base unit price (before O&P), computed in the workbook,
   * by the Owner, from the same coefficients and prices.
   *
   * It is a cross-check, never an input: nothing is ever written from it. If
   * SIMPROK's Cost Kernel and this column agree to the cent, two independent
   * calculators reached the same number — which is a far stronger statement
   * than a fixture asserting its own expectation.
   */
  readonly oracleBaseUnitPrice: Readonly<Record<string, string>>;
}

export function goldenWorkbookPath(): string {
  return (process.env.B1B12_GOLDEN_WORKBOOK_PATH ?? '').trim();
}

export function isGoldenRequested(): boolean {
  return goldenWorkbookPath() !== '';
}

/**
 * The single gate every byte passes BEFORE it is interpreted as a workbook.
 * Reading a spreadsheet is already an act of trust; identity is established
 * first and parsing is downstream of it, never the other way round.
 */
export function assertExactGoldenBytes(bytes: Buffer, path: string) {
  const size = bytes.length;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (size !== GOLDEN_SIZE || sha256 !== GOLDEN_SHA256) {
    throw new Error(
      `GOLDEN_WORKBOOK_IDENTITY_MISMATCH: refusing to interpret this file. ` +
        `path=${path} size=${size} (expected ${GOLDEN_SIZE}) ` +
        `sha256=${sha256} (expected ${GOLDEN_SHA256})`,
    );
  }
  return { size, sha256 };
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/gu, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function readSheetCells(xml: string): Map<number, Map<string, string>> {
  const rows = new Map<number, Map<string, string>>();
  const rowRe = /<(?:\w+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gu;
  const cellRe =
    /<(?:\w+:)?c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gu;
  const valueRe = /<(?:\w+:)?(?:v|t)>([\s\S]*?)<\/(?:\w+:)?(?:v|t)>/u;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells = new Map<string, string>();
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[2])) !== null) {
      const value = valueRe.exec(cellMatch[2] ?? '');
      if (value) cells.set(cellMatch[1], decodeXmlText(value[1]).trim());
    }
    rows.set(Number(rowMatch[1]), cells);
  }
  return rows;
}

async function readSheet(zip: JSZip, sheetName: string) {
  const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const targets = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/>/gu) ?? []) {
    const id = /Id="([^"]+)"/u.exec(rel)?.[1];
    const target = /Target="([^"]+)"/u.exec(rel)?.[1];
    if (id && target) targets.set(id, target.replace(/^\//u, ''));
  }
  for (const sheet of workbookXml.match(/<(?:\w+:)?sheet\b[^>]*\/>/gu) ?? []) {
    const name = /name="([^"]+)"/u.exec(sheet)?.[1];
    const rid = /r:id="([^"]+)"/u.exec(sheet)?.[1];
    if (name === sheetName && rid && targets.has(rid)) {
      return readSheetCells(await zip.file(targets.get(rid)!)!.async('string'));
    }
  }
  throw new Error(`sheet not found: ${sheetName}`);
}

/** Column letter for a header caption, so nothing hard-codes a position. */
function columnOf(header: Map<string, string>, caption: string): string {
  for (const [col, value] of header) if (value === caption) return col;
  throw new Error(`header not found: ${caption}`);
}

/**
 * Load the Golden evidence. Gated on the REQUEST, not on the file: once a path
 * is named, this reaches a verdict or throws — it is never silently skipped.
 */
export async function loadGoldenEvidence(): Promise<GoldenEvidence> {
  const path = goldenWorkbookPath();
  if (path === '') {
    throw new Error(
      'GOLDEN_WORKBOOK_NOT_REQUESTED: B1B12_GOLDEN_WORKBOOK_PATH is unset. ' +
        'Callers must check isGoldenRequested() before loading.',
    );
  }
  if (!existsSync(path)) {
    throw new Error(
      `GOLDEN_WORKBOOK_NOT_FOUND: B1B12_GOLDEN_WORKBOOK_PATH was set to "${path}", ` +
        `but no file exists there. An explicitly requested exact-Golden run is never skipped.`,
    );
  }

  const bytes = readFileSync(path);
  const identity = assertExactGoldenBytes(bytes, path);
  const zip = await JSZip.loadAsync(bytes);

  const index = await readSheet(zip, '01_AHSP_INDEX');
  const iHeader = index.get(1)!;
  const iItem = columnOf(iHeader, 'Item');
  const iCode = columnOf(iHeader, 'AHSP Code');
  const iDescription = columnOf(iHeader, 'Official Description');
  const iOfficialUnit = columnOf(iHeader, 'Official Unit');
  const iCanonical = columnOf(iHeader, 'Canonical Unit');
  const iTranscription = columnOf(iHeader, 'Transcription Status');
  const iGolden = columnOf(iHeader, 'Golden Pack Status');
  const items: GoldenAhspItem[] = [...index.entries()]
    .filter(([rowNumber]) => rowNumber > 1)
    .map(([, cells]) => ({
      item: cells.get(iItem) ?? '',
      code: cells.get(iCode) ?? '',
      officialDescription: cells.get(iDescription) ?? '',
      officialUnit: cells.get(iOfficialUnit) ?? '',
      canonicalUnit: cells.get(iCanonical) ?? '',
      transcriptionStatus: cells.get(iTranscription) ?? '',
      goldenPackStatus: cells.get(iGolden) ?? '',
    }))
    .filter((row) => row.item !== '');

  const matrix = await readSheet(zip, '02_RESOURCE_MATRIX');
  const mHeader = matrix.get(1)!;
  const mItem = columnOf(mHeader, 'Item');
  const mCode = columnOf(mHeader, 'AHSP Code');
  const mGroup = columnOf(mHeader, 'Group');
  const mRawText = columnOf(mHeader, 'Raw Resource Text');
  const mResourceCode = columnOf(mHeader, 'Resource Code');
  const mCandidate = columnOf(mHeader, 'Canonical Candidate');
  const mRawUnit = columnOf(mHeader, 'Raw Unit');
  const mCanonicalUnit = columnOf(mHeader, 'Canonical Unit');
  const mCoefficient = columnOf(mHeader, 'Numeric Coefficient');
  const mPrice = columnOf(mHeader, 'Published Unit Price');
  const resources: GoldenResourceRow[] = [...matrix.entries()]
    .filter(([rowNumber]) => rowNumber > 1)
    .map(([rowNumber, cells]) => {
      const group = cells.get(mGroup) ?? '';
      return {
        item: cells.get(mItem) ?? '',
        ahspCode: cells.get(mCode) ?? '',
        group,
        resourceType: GROUP_RESOURCE_TYPE[group] ?? '',
        rawResourceText: cells.get(mRawText) ?? '',
        resourceCode: cells.get(mResourceCode) ?? '',
        canonicalCandidate: cells.get(mCandidate) ?? '',
        rawUnit: cells.get(mRawUnit) ?? '',
        canonicalUnit: cells.get(mCanonicalUnit) ?? '',
        coefficient: cells.get(mCoefficient) ?? '',
        publishedUnitPrice: cells.get(mPrice) ?? '',
        sourceRow: rowNumber,
      };
    })
    .filter((row) => row.item !== '' && row.rawUnit !== '');

  const summary = await readSheet(zip, '04_PUBLISHED_SUMMARY');
  const sHeader = summary.get(1)!;
  const sItem = columnOf(sHeader, 'Item');
  const sOracleD = columnOf(sHeader, 'Oracle D');
  const oracleBaseUnitPrice: Record<string, string> = {};
  for (const [rowNumber, cells] of summary.entries()) {
    if (rowNumber === 1) continue;
    const item = cells.get(sItem) ?? '';
    const oracle = cells.get(sOracleD) ?? '';
    if (item !== '' && oracle !== '') oracleBaseUnitPrice[item] = oracle;
  }

  const fileName = path.replace(/^.*[\\/]/u, '');
  return {
    path,
    fileName,
    ...identity,
    items,
    resources,
    oracleBaseUnitPrice,
  };
}

/**
 * One catalog identity per (canonical candidate, resource type, canonical
 * unit) the evidence actually states.
 *
 * NO PREFERENCE IS INVENTED. Where the pack states TWO units for one
 * name+type — it does, exactly once: "Mortar" (M279) is priced per m3 in
 * B4-B8 and per kg in B9-B10, both at 4752 — this yields TWO identities,
 * because that is what the evidence says. SIMPROK is then free to refuse the
 * pair as MULTIPLE_CANDIDATES_NEEDS_REVIEW, which is the correct product
 * behaviour and precisely what must NOT be papered over here.
 */
export interface GoldenCatalogIdentity {
  /** Stable join key — the same one `catalogKeyFor` computes for an AHSP row. */
  readonly key: string;
  readonly name: string;
  readonly resourceType: string;
  readonly baseUnit: string;
  readonly resourceCode: string;
  readonly publishedUnitPrice: string;
  /** Which B-items reference it, for evidence in the report. */
  readonly items: ReadonlyArray<string>;
  /** Every raw spelling seen for it, with its workbook row. */
  readonly sightings: ReadonlyArray<{ rawText: string; sourceRow: number }>;
}

export function buildCatalogIdentities(
  resources: ReadonlyArray<GoldenResourceRow>,
): GoldenCatalogIdentity[] {
  const byKey = new Map<
    string,
    {
      key: string;
      name: string;
      resourceType: string;
      baseUnit: string;
      resourceCode: string;
      publishedUnitPrice: string;
      items: Set<string>;
      sightings: Array<{ rawText: string; sourceRow: number }>;
    }
  >();
  for (const row of resources) {
    // The canonical unit is the pack's own normalisation of its raw spelling,
    // so "unit"/"Unit" is ONE identity while m3/kg stay two. Case is not a
    // fact; a dimension is.
    const key = catalogKeyFor(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.items.add(row.item);
      existing.sightings.push({
        rawText: row.rawResourceText,
        sourceRow: row.sourceRow,
      });
      continue;
    }
    byKey.set(key, {
      key,
      name: row.canonicalCandidate,
      resourceType: row.resourceType,
      // The catalog's base unit is the source's OWN spelling, not a rewrite.
      baseUnit: row.rawUnit,
      resourceCode: row.resourceCode,
      publishedUnitPrice: row.publishedUnitPrice,
      items: new Set([row.item]),
      sightings: [{ rawText: row.rawResourceText, sourceRow: row.sourceRow }],
    });
  }
  return [...byKey.values()].map((entry) => ({
    ...entry,
    items: [...entry.items],
  }));
}

/** The catalog key an AHSP resource row points at. */
export function catalogKeyFor(row: GoldenResourceRow): string {
  return `${row.canonicalCandidate.trim().toLowerCase()}||${row.resourceType}||${row.canonicalUnit.trim().toLowerCase()}`;
}

/**
 * Names that the evidence itself makes ambiguous: one (name, type) stated with
 * more than one canonical unit. Reported, never resolved — SIMPROK refuses to
 * choose between equally strong candidates, and so does this fixture.
 */
export function ambiguousCatalogNames(
  identities: ReadonlyArray<GoldenCatalogIdentity>,
): string[] {
  const byNameType = new Map<string, number>();
  for (const identity of identities) {
    const key = `${identity.name.trim().toLowerCase()}||${identity.resourceType}`;
    byNameType.set(key, (byNameType.get(key) ?? 0) + 1);
  }
  return [...byNameType.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

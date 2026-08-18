/**
 * USI-01 LAW 6 — LANGUAGE RAW != CANONICAL MEANING.
 *
 * A controlled vocabulary that maps a header's DISPLAY TEXT, in whatever
 * language the source wrote it, onto a SIMPROK column ROLE. Two rules govern
 * everything here:
 *
 *   1. The original header text is never erased. Detection records the verbatim
 *      string alongside the role it was matched to, so "Prix unitaire" is still
 *      readable as "Prix unitaire" after SIMPROK has understood it as PRICE.
 *   2. A role is a STRUCTURAL claim, not an identity claim. Knowing that column
 *      4 holds prices says nothing about which resource, which unit, or whether
 *      any of it is true — Resource Identity and Unit resolution remain the
 *      separate, human-governed steps they already are (LAW 4).
 *
 * This is deliberately NOT the multilingual catalog. It is the seam that lets
 * one be added later without the pipeline changing: more aliases, same roles.
 */

export type ColumnRole =
  | 'ROW_NUMBER'
  | 'RESOURCE_CODE'
  | 'RESOURCE_NAME'
  | 'SOURCE_UNIT'
  | 'SIMPROK_UNIT_CANDIDATE'
  | 'PRICE'
  | 'REGION_LABEL'
  | 'CATEGORY_CODE'
  | 'CATEGORY_NAME'
  | 'NOTE';

/**
 * Folds a header for MATCHING only. The folded form is never stored as the
 * header's identity — `SourceCell.rawText` and the recorded `headerText`
 * remain the source's own words.
 *
 * Folding removes: case, diacritics, parenthetical qualifiers ("HARGA (Rp)"),
 * and the difference between `_`, `-` and space. All of that is presentation;
 * none of it is meaning.
 */
export function foldHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EXACT_ALIASES: Record<ColumnRole, readonly string[]> = {
  ROW_NUMBER: ['no', 'nomor', 'num', 'number', 'item no', 'no urut'],
  RESOURCE_CODE: [
    'code',
    'kode',
    'kode barang',
    'kode sumber daya',
    'resource code',
    'sku',
    'kode item',
  ],
  RESOURCE_NAME: [
    'resource name',
    'resource',
    'nama',
    'nama barang',
    'nama bahan',
    'nama item',
    'nama sumber daya',
    'uraian',
    'material',
    'bahan',
    'tenaga kerja',
    'peralatan',
    'item',
    'description',
    'deskripsi',
    'name',
    'designation',
    'nom',
    'jenis',
  ],
  SOURCE_UNIT: [
    'source unit',
    'satuan',
    'satuan sumber',
    'satuan asli',
    'unit',
    'uom',
    'unite',
  ],
  SIMPROK_UNIT_CANDIDATE: [
    'simprok unit candidate',
    'simprok unit',
    'satuan simprok',
    'unit simprok',
    'kandidat satuan simprok',
  ],
  PRICE: [
    'price',
    'harga',
    'harga satuan',
    'unit price',
    'rate',
    'prix unitaire',
    'prix',
    'tarif',
    'nilai',
  ],
  CATEGORY_CODE: ['category code', 'kode kategori', 'kode golongan', 'kategori kode'],
  CATEGORY_NAME: [
    'category name',
    'category',
    'kategori',
    'golongan',
    'jenis sumber daya',
    'kelompok',
    'klasifikasi',
  ],
  REGION_LABEL: [
    'region',
    'wilayah',
    'daerah',
    'kota',
    'kabupaten',
    'kota kabupaten',
    'kecamatan',
    'jurisdiction',
    'lokasi harga',
  ],
  NOTE: [
    'ket',
    'keterangan',
    'catatan',
    'note',
    'notes',
    'remarks',
    'sumber',
    'source',
    'provenance',
    'referensi',
  ],
};

/**
 * Bounded patterns for headers that legitimately carry a period or a
 * qualifier, e.g. `selected_price_2024` or `harga satuan 2024`. The year is
 * matched but NEVER interpreted — a column named for 2024 is not evidence that
 * its prices are effective in 2024. That claim stays where it already lives:
 * the batch's human-stated temporal provenance.
 */
const PATTERN_ALIASES: ReadonlyArray<{ role: ColumnRole; pattern: RegExp }> = [
  { role: 'PRICE', pattern: /^selected price(?: \d{4})?$/ },
  { role: 'PRICE', pattern: /^harga(?: satuan)?(?: \d{4})?$/ },
  { role: 'PRICE', pattern: /^unit price(?: \d{4})?$/ },
  { role: 'RESOURCE_NAME', pattern: /^resource name$/ },
  { role: 'SOURCE_UNIT', pattern: /^source unit$/ },
];

const EXACT_LOOKUP = new Map<string, ColumnRole>();
for (const [role, aliases] of Object.entries(EXACT_ALIASES) as Array<
  [ColumnRole, readonly string[]]
>) {
  for (const alias of aliases) {
    // First registration wins, so the table above reads top-to-bottom as its
    // own precedence order and an alias can never silently change role when a
    // later group grows.
    if (!EXACT_LOOKUP.has(alias)) EXACT_LOOKUP.set(alias, role);
  }
}

export interface HeaderMatch {
  /** The source's own words, verbatim (LAW 6). */
  headerText: string;
  /** 1-based column number in the source table. */
  columnNumber: number;
  /** Null when this vocabulary recognizes nothing — which is itself evidence. */
  role: ColumnRole | null;
}

export function matchHeaderRole(text: string): ColumnRole | null {
  const folded = foldHeader(text);
  if (folded === '') return null;
  const exact = EXACT_LOOKUP.get(folded);
  if (exact) return exact;
  for (const { role, pattern } of PATTERN_ALIASES) {
    if (pattern.test(folded)) return role;
  }
  return null;
}


/**
 * USI-01R2 §7 — WHAT THE SOURCE'S OWN CATEGORY WORDS MEAN.
 *
 * THESE RULES WERE DERIVED FROM THE OWNER'S REAL WORKBOOK, NOT INVENTED.
 * Reading `BASIC PRICE IKK - SIMPROK READY 2024.xlsx` first showed exactly seven
 * distinct `category_name` values across its 86 rows:
 *
 *   BAHAN BESI DAN ALUMINIUM            29 rows
 *   UPAH                                17 rows
 *   ALAT                                15 rows
 *   BAHAN AGREGAT KASAR, BAHAN PEREKAT   9 rows
 *   LAIN-LAIN                            8 rows
 *   BAHAN KAYU                           5 rows
 *   BAHAN DASAR                          3 rows
 *
 * Two things follow, and both are load-bearing.
 *
 * FIRST: MATCHING IS BY LEADING WORD, NOT BY SUBSTRING. Four of these are
 * "BAHAN ..." phrases that a one-word exact table would have missed entirely.
 * But substring matching would be far worse — "BAHAN BAKAR ALAT BERAT" contains
 * both "BAHAN" and "ALAT", and a substring rule would map it by whichever
 * happened to be tested first. The leading word is what the source uses to name
 * the family; everything after it qualifies that family.
 *
 * SECOND: "LAIN-LAIN" IS NOT A FAMILY. It means "other", and its eight rows
 * (Solar, Strorox-100, bekisting spacers…) span more than one real family. It is
 * deliberately absent from the table below, so those rows resolve to NOTHING and
 * wait for a human. Mapping them to MATERIAL because most of them look like
 * materials is precisely the manufactured certainty SIMPROK exists to refuse.
 *
 * MEANING NEVER COMES FROM A CODE LETTER. This workbook's "F" means equipment
 * only because its rows also say ALAT. Teaching SIMPROK that F is universally
 * equipment would turn one document's private shorthand into a global law.
 */
export type ResourceFamily = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

/** Leading words that NAME a resource family. Order is irrelevant; each is exact. */
const FAMILY_BY_LEADING_WORD: ReadonlyArray<{
  family: ResourceFamily;
  leadingWords: readonly string[];
}> = [
  // "ALAT", "ALAT BERAT", "PERALATAN", "SEWA ALAT" …
  { family: 'EQUIPMENT', leadingWords: ['alat', 'peralatan', 'equipment'] },
  // "BAHAN", "BAHAN KAYU", "BAHAN BESI DAN ALUMINIUM", "MATERIAL" …
  { family: 'MATERIAL', leadingWords: ['bahan', 'material', 'materials'] },
  // "UPAH", "UPAH TENAGA KERJA", "TENAGA KERJA", "LABOR" …
  { family: 'LABOR', leadingWords: ['upah', 'labor', 'labour', 'pekerja'] },
];

/** Two-word openings whose meaning only exists as a pair. */
const FAMILY_BY_LEADING_PAIR: ReadonlyArray<{
  family: ResourceFamily;
  leadingPair: string;
}> = [
  { family: 'LABOR', leadingPair: 'tenaga kerja' },
  { family: 'EQUIPMENT', leadingPair: 'sewa alat' },
  { family: 'EQUIPMENT', leadingPair: 'sewa peralatan' },
];

/**
 * Categories the source states but SIMPROK must NOT map, listed explicitly so
 * the refusal is a decision on record rather than an accident of vocabulary.
 */
const NON_FAMILY_CATEGORIES: readonly string[] = [
  'lain lain', // "LAIN-LAIN" — miscellaneous; spans several real families.
  'lainnya',
  'lain',
  'other',
  'others',
  'misc',
  'umum',
];

export function resourceFamilyOfCategoryText(
  text: string | null | undefined,
): ResourceFamily | null {
  if (!text) return null;
  const folded = foldHeader(text);
  if (folded === '') return null;

  // An explicit "not a family" answer outranks everything below it.
  if (NON_FAMILY_CATEGORIES.includes(folded)) return null;

  const words = folded.split(' ');
  const pair = words.slice(0, 2).join(' ');
  const byPair = FAMILY_BY_LEADING_PAIR.find((e) => e.leadingPair === pair);
  if (byPair) return byPair.family;

  const byWord = FAMILY_BY_LEADING_WORD.find((e) =>
    e.leadingWords.includes(words[0]),
  );
  return byWord ? byWord.family : null;
}

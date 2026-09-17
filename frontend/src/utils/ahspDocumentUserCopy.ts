/**
 * User-facing copy for AHSP document understanding.
 *
 * Technical reason codes stay on the knowledge object for audit and
 * intelligence. This module only translates them for a human. It does not
 * invent facts, change fail-closed, or decide whether a pekerjaan is proved.
 */

const REASON_COPY: Record<string, string> = {
  SOURCE_UNREADABLE: 'Berkas tidak dapat dibuka.',
  STRUCTURE_UNSUPPORTED: 'Bentuk dokumen ini belum dapat dibaca sebagai analisa AHSP.',
  SEMANTIC_AMBIGUITY: 'Isi dokumen masih bisa dibaca lebih dari satu cara.',
  MISSING_WORK_ITEM: 'Identitas pekerjaan belum lengkap.',
  MISSING_RESOURCE: 'Komponen pembentuk belum lengkap.',
  MISSING_UNIT: 'Satuan komponen belum tertera di dokumen.',
  // "Not found" is what SIMPROK knows: a source may state its output unit in a form
  // the reader does not read yet, so this never says the document lacks one.
  MISSING_OUTPUT_UNIT: 'Satuan hasil pekerjaan belum ditemukan pada dokumen.',
  // Sent only when the Unit Kernel PROVED the statements name different units; a
  // spelling it does not know waits as an unknown unit instead.
  SOURCE_UNIT_CONFLICT:
    'Dokumen menyatakan dua satuan hasil yang berbeda, sehingga SIMPROK belum dapat menetapkannya dengan aman.',
  INVALID_COEFFICIENT: 'Koefisien belum lengkap atau tidak sah.',
  RESOURCE_UNRESOLVED: 'Komponen belum dapat dicocokkan dengan data SIMPROK.',
  // "Belum terbukti" is not "tidak ada". When the identity kernel narrowed the
  // question to real catalogue rows, saying nothing was found would be false.
  // ACG-01.1: this code is also carried when every row found was RULED OUT, so
  // the sentence names what is true in both cases — related catalogue data was
  // found — and never calls a refused row a possible match.
  RESOURCE_CANDIDATES_FOUND:
    'SIMPROK menemukan data katalog yang berkaitan dengan komponen ini, tetapi identitasnya belum terbukti.',
  // The same reason for a component's unit and for an output unit whose spelling
  // SIMPROK does not know — so it names neither, and never calls two spellings different.
  UNIT_UNRESOLVED: 'Satuan yang tertulis belum dikenali dalam data SIMPROK.',
  AUTHORITY_UNPROVEN: 'Peraturan pada dokumen belum terbukti.',
  CURRENTNESS_UNPROVEN: 'Tanggal berlaku belum tertera di dokumen.',
  DUPLICATE_IDENTITY: 'Pekerjaan ini sudah ada di SIMPROK.',
  IDENTITY_POSSIBLE_MATCH: 'Menunggu keputusan Anda: kemungkinan sama dengan pekerjaan yang sudah ada.',
};

export const explainAhspItemReasons = (codes: readonly string[] | undefined): string => {
  const unique = [...new Set(codes ?? [])];
  for (const code of unique) {
    const copy = REASON_COPY[code];
    if (copy) return copy;
  }
  return 'Beberapa informasi pada sumber belum cukup untuk memastikan pekerjaan ini.';
};

/**
 * Reasons that never keep a work item from being saved on their own: a component
 * whose identity is not proved yet is saved with the source's own wording, and an
 * unstated validity date does not block a recipe.
 */
const NEVER_HOLDS_ALONE = new Set(['RESOURCE_UNRESOLVED', 'RESOURCE_CANDIDATES_FOUND', 'CURRENTNESS_UNPROVEN']);

/**
 * Why a work item is still WAITING. When it also carries a reason that would not
 * hold it back by itself, that reason is not why it waits — the fact that is
 * really missing is named instead.
 */
export const explainWaitingItemReasons = (codes: readonly string[] | undefined): string => {
  const unique = [...new Set(codes ?? [])];
  const holding = unique.filter((code) => !NEVER_HOLDS_ALONE.has(code));
  return explainAhspItemReasons(holding.length > 0 ? holding : unique);
};

/**
 * The facts a DOCUMENT must state, most fundamental first. An item waiting on one
 * of these waits for the source itself — never for SIMPROK's vocabulary or a
 * person's decision — so it is grouped by the first of these it carries.
 */
export const SOURCE_FACT_REASONS: readonly string[] = [
  'SOURCE_UNIT_CONFLICT',
  'MISSING_OUTPUT_UNIT',
  'MISSING_WORK_ITEM',
  'MISSING_RESOURCE',
  'MISSING_UNIT',
  'INVALID_COEFFICIENT',
  'SEMANTIC_AMBIGUITY',
  'STRUCTURE_UNSUPPORTED',
  'SOURCE_UNREADABLE',
];

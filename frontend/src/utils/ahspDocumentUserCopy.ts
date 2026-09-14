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
  MISSING_OUTPUT_UNIT: 'Satuan hasil pekerjaan belum tertera di dokumen.',
  INVALID_COEFFICIENT: 'Koefisien belum lengkap atau tidak sah.',
  RESOURCE_UNRESOLVED: 'Komponen belum dapat dicocokkan dengan data SIMPROK.',
  // "Belum terbukti" is not "tidak ada". When the identity kernel narrowed the
  // question to real catalogue rows, saying nothing was found would be false.
  // ACG-01.1: this code is also carried when every row found was RULED OUT, so
  // the sentence names what is true in both cases — related catalogue data was
  // found — and never calls a refused row a possible match.
  RESOURCE_CANDIDATES_FOUND:
    'SIMPROK menemukan data katalog yang berkaitan dengan komponen ini, tetapi identitasnya belum terbukti.',
  UNIT_UNRESOLVED: 'Satuan komponen belum dikenali dalam data SIMPROK.',
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

/**
 * SIMPROK — lower-level classification vocabulary CONSUMER.
 *
 * CANONICAL WRITE AUTHORITY:
 *   shared/construction-taxonomy.vocabulary.json
 *
 * This module no longer owns an editable list. Kategori, the approved
 * Kategori → Subkategori edges, and Jenis Pekerjaan are read from that file.
 * Repeated Subkategori names stay as distinct path entries. A Kategori the
 * file does not key has no baseline children; subkategoriForBidang returns []
 * rather than inventing any.
 *
 * mergeVocabulary still keeps a stored value visible. It does not write a node.
 */

import vocabulary from '../../shared/construction-taxonomy.vocabulary.json' with { type: 'json' };

export const BIDANG: readonly string[] = vocabulary.kategori;

export const SUBKATEGORI_BY_BIDANG: Readonly<Record<string, readonly string[]>> =
  vocabulary.subkategoriByKategori;

export const JENIS_PEKERJAAN: readonly string[] = vocabulary.jenisPekerjaan;

/**
 * Context-aware Subkategori for a selected Bidang. Returns the curated list, or
 * [] for an unknown / unmapped / blank Bidang — an honest empty, never a guess.
 */
export function subkategoriForBidang(bidang: string | null | undefined): readonly string[] {
  if (!bidang) return [];
  return SUBKATEGORI_BY_BIDANG[bidang.trim()] ?? [];
}

/**
 * Filter honesty: the curated vocabulary FIRST (in curated order), then any
 * value actually present in the data that the curated list does not already
 * contain — so a real stored value is never hidden from a filter. Blank/nullish
 * present values are ignored; duplicates are removed; the appended data values
 * are sorted for a stable order.
 */
export function mergeVocabulary(
  curated: readonly string[],
  present: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of curated) {
    const value = item.trim();
    if (value !== '' && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  const extra: string[] = [];
  for (const item of present) {
    const value = (item ?? '').trim();
    if (value !== '' && !seen.has(value)) {
      seen.add(value);
      extra.push(value);
    }
  }
  extra.sort((a, b) => a.localeCompare(b, 'id'));
  return [...out, ...extra];
}

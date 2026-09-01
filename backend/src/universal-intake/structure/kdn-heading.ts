import { foldHeader } from './header-vocabulary';

/**
 * BP-KDN-01 — HEADING LAW, NOT A SECOND IMPORTER.
 *
 * Reuses `foldHeader` from the Universal Smart Intake vocabulary so "KDN (%)",
 * "KDN%", and "kdn" are the same DISPLAY after folding, while the source's own
 * words stay on the column. This module never assigns a load-bearing
 * `ColumnRole`: KDN is optional, and injecting it into structure detection
 * would let a KDN heading change which header row wins, or let two KDN
 * headings silently take the leftmost column.
 *
 * CLEAR     the heading proves it is a %KDN column. Auto-map.
 * AMBIGUOUS KDN-like wording that is NOT %KDN by itself (LOCAL, TKDN, …).
 *           Propose a question; never establish.
 * NONE      not a KDN heading. Values between 0 and 100 prove nothing.
 */

export type KdnHeadingKind = 'CLEAR' | 'AMBIGUOUS' | 'NONE';

/**
 * Folded forms that PROVE a %KDN column. First registration wins; order is
 * the precedence a reader can audit.
 *
 * `foldHeader` already strips parentheticals and non-alphanumerics, so
 * `KDN (%)`, `% KDN`, `KDN%` and `KDN` all fold to `kdn`.
 */
const CLEAR_EXACT: readonly string[] = [
  'kdn',
  'persentase kdn',
  'persentase kandungan dalam negeri',
  'kandungan dalam negeri',
];

/**
 * Bounded patterns for a CLEAR heading that also carries a period qualifier
 * (e.g. `KDN 2024`). The year is matched and NEVER interpreted as the
 * effective year of the percentage.
 */
const CLEAR_PATTERNS: readonly RegExp[] = [
  /^kdn(?: \d{4})?$/,
  /^persentase kdn(?: \d{4})?$/,
];

/**
 * Headings that LOOK like domestic-content but do not prove %KDN.
 *
 * LOCAL / LOKAL / DOMESTIC / TINGKAT LOKAL are the Owner-named traps:
 * they must never be auto-established. TKDN is the RAB/Project aggregate
 * word; a source that wrote it on an item column is asking a human, not
 * granting SIMPROK the right to guess.
 */
const AMBIGUOUS_EXACT: readonly string[] = [
  'local',
  'lokal',
  'domestic',
  'tingkat lokal',
  'local content',
  'kandungan lokal',
  'tkdn',
  'persentase tkdn',
];

export function matchKdnHeading(
  text: string | null | undefined,
): KdnHeadingKind {
  if (text === null || text === undefined) return 'NONE';
  const folded = foldHeader(text);
  if (folded === '') return 'NONE';
  if (CLEAR_EXACT.includes(folded)) return 'CLEAR';
  if (CLEAR_PATTERNS.some((pattern) => pattern.test(folded))) return 'CLEAR';
  if (AMBIGUOUS_EXACT.includes(folded)) return 'AMBIGUOUS';
  return 'NONE';
}

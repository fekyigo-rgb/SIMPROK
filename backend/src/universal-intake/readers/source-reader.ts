import { SourceEnvelope } from '../source-envelope';
import { SourceRead } from './source-table';

/**
 * USI-01 §4 — THE READER BOUNDARY.
 *
 * A reader answers exactly two questions: "can I decode this?" and "here is
 * the grid". It knows nothing about prices, regions, units or trust. Adding
 * XLS, ODS, JSON or an API payload later means adding one implementation of
 * this interface and registering it — no Basic Price review, verification or
 * publication code is in the blast radius (test A3).
 */
export interface SourceReader {
  /** Stable identity recorded in provenance, e.g. `XLSX_EXCELJS`. */
  readonly id: string;
  /** Bumped when this reader's OUTPUT for identical bytes would change. */
  readonly contractVersion: string;
  /**
   * Lowercased file extensions this reader claims, including the dot.
   * Extension is a HINT, never sole authority (§14) — `read` still fails
   * closed on bytes it cannot decode.
   */
  readonly extensions: readonly string[];
  /** Media types this reader claims. Also a hint, never authority. */
  readonly mediaTypes: readonly string[];

  read(envelope: SourceEnvelope): Promise<SourceRead>;
}

export function extensionOf(fileName: string): string {
  const index = (fileName ?? '').lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

import type { SourceCell } from '../readers/source-table';
import { interpretKdnLiteral, KDN_LITERAL_REASONS } from './kdn-literal';

/**
 * BP-KDN-01 — one cell, read as a %KDN candidate.
 *
 * Native spreadsheet numbers are believed as numbers (never re-read from
 * display text). Text cells and CSV fields go through `interpretKdnLiteral`.
 * Blank is UNKNOWN. Invalid is named and never coerced to zero.
 */

export interface KdnCellEvidence {
  rawKdnTextValue: string | null;
  rawKdnNumericRoundTripString: string | null;
  rawKdnDisplayText: string | null;
  proposedCanonicalKdn: string | null;
  kdnReasonCode: string | null;
}

export const EMPTY_KDN_EVIDENCE: KdnCellEvidence = {
  rawKdnTextValue: null,
  rawKdnNumericRoundTripString: null,
  rawKdnDisplayText: null,
  proposedCanonicalKdn: null,
  kdnReasonCode: null,
};

export function readKdnCell(cell: SourceCell | null): KdnCellEvidence {
  if (cell === null) {
    return { ...EMPTY_KDN_EVIDENCE };
  }

  const nativeCanonical =
    cell.native?.numericRoundTripString ??
    cell.native?.cachedResultRoundTripString ??
    null;
  const displayText = cell.text;
  const rawText = cell.rawText ?? cell.native?.textValue ?? displayText;

  const sourceForLiteral = nativeCanonical ?? displayText;
  const reading = interpretKdnLiteral(sourceForLiteral);

  if (reading.status === 'UNKNOWN') {
    return {
      rawKdnTextValue: rawText,
      rawKdnNumericRoundTripString: nativeCanonical,
      rawKdnDisplayText: displayText,
      proposedCanonicalKdn: null,
      kdnReasonCode: null,
    };
  }

  if (reading.status === 'INVALID') {
    return {
      rawKdnTextValue: rawText,
      rawKdnNumericRoundTripString: nativeCanonical,
      rawKdnDisplayText: displayText,
      proposedCanonicalKdn: null,
      kdnReasonCode: reading.reason ?? KDN_LITERAL_REASONS.NOT_NUMERIC,
    };
  }

  return {
    rawKdnTextValue: rawText,
    rawKdnNumericRoundTripString: nativeCanonical,
    rawKdnDisplayText: displayText,
    proposedCanonicalKdn: reading.canonicalPercent,
    kdnReasonCode: null,
  };
}

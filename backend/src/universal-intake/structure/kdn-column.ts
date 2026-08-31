import { matchKdnHeading, type KdnHeadingKind } from './kdn-heading';

/**
 * BP-KDN-01 — OPTIONAL KDN COLUMN INTERPRETATION.
 *
 * Runs AFTER structure detection, against the headers the detector already
 * named. It never changes which table shape was proven, never picks the
 * leftmost of two KDN columns, and never treats an unlabelled 0–100 numeric
 * column as KDN.
 *
 * Classification:
 *   ESTABLISHED   exactly one CLEAR heading, or a human confirmed one
 *                 AMBIGUOUS/CONFLICT candidate. Auto-map.
 *   ABSENT        no CLEAR and no AMBIGUOUS heading. Import continues.
 *   NEEDS_REVIEW  ambiguous heading(s) and/or multiple CLEAR headings.
 *                 Do not guess; do not fail-stop the price workflow.
 */

export interface KdnColumnRef {
  columnNumber: number;
  headerText: string;
  kind: KdnHeadingKind;
}

export type KdnColumnDecision =
  | {
      status: 'ESTABLISHED';
      column: KdnColumnRef;
      /**
       * True when a human selection was REQUIRED to settle the column:
       * multiple CLEAR candidates, or only AMBIGUOUS candidates. It is
       * NOT "the document never named a column". Exactly one CLEAR heading
       * is the document deciding — even if weaker AMBIGUOUS headings sit
       * beside it — so `humanConfirmed` stays false and a stray
       * `selectedKdnColumn` cannot relocate or fork that reading.
       */
      humanConfirmed: boolean;
    }
  | {
      status: 'ABSENT';
    }
  | {
      status: 'NEEDS_REVIEW';
      reason: 'AMBIGUOUS' | 'CONFLICT';
      candidates: KdnColumnRef[];
    };

export function interpretKdnColumns(
  columns: ReadonlyArray<{ columnNumber: number; headerText: string }>,
  selectedKdnColumn?: number | null,
): KdnColumnDecision {
  const classified: KdnColumnRef[] = columns
    .map((column) => ({
      columnNumber: column.columnNumber,
      headerText: column.headerText,
      kind: matchKdnHeading(column.headerText),
    }))
    .filter((column) => column.kind !== 'NONE');

  const clear = classified.filter((column) => column.kind === 'CLEAR');
  const ambiguous = classified.filter((column) => column.kind === 'AMBIGUOUS');

  // THE DOCUMENT WINS. A proven KDN heading is not overridable by a request
  // parameter — otherwise a stray selectedKdnColumn would silently relocate
  // the fact, or fork identity for two readings that are the same reading.
  if (clear.length === 1) {
    return {
      status: 'ESTABLISHED',
      column: clear[0],
      humanConfirmed: false,
    };
  }

  if (clear.length > 1) {
    const confirmed = confirmSelection(clear, selectedKdnColumn);
    if (confirmed) {
      return {
        status: 'ESTABLISHED',
        column: confirmed,
        humanConfirmed: true,
      };
    }
    return {
      status: 'NEEDS_REVIEW',
      reason: 'CONFLICT',
      candidates: clear,
    };
  }

  if (ambiguous.length > 0) {
    const confirmed = confirmSelection(ambiguous, selectedKdnColumn);
    if (confirmed) {
      return {
        status: 'ESTABLISHED',
        column: confirmed,
        humanConfirmed: true,
      };
    }
    return {
      status: 'NEEDS_REVIEW',
      reason: 'AMBIGUOUS',
      candidates: ambiguous,
    };
  }

  // A selected column that is neither CLEAR nor AMBIGUOUS is not a KDN
  // column. Ignoring it is fail-closed: SIMPROK will not invent KDN from
  // an arbitrary column number the client pointed at.
  return { status: 'ABSENT' };
}

function confirmSelection(
  candidates: KdnColumnRef[],
  selectedKdnColumn: number | null | undefined,
): KdnColumnRef | null {
  if (selectedKdnColumn === null || selectedKdnColumn === undefined) {
    return null;
  }
  return (
    candidates.find((column) => column.columnNumber === selectedKdnColumn) ??
    null
  );
}

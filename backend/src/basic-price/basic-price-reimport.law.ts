/**
 * SMART RE-IMPORT — PRODUCT CLASSIFICATION, NOT A SECOND IDENTITY ENGINE.
 *
 * Identity remains where it already lives:
 *   - exact replay      = workspace + importFingerprint
 *   - observation retry = workspace + sourceObservationKey
 *   - corrected reading = the interpretation segments already inside the
 *     fingerprint (see intakeIdentitySegments in basic-price-import.service.ts)
 *
 * This module does not hash, match, or mint anything. It NAMES the relation
 * the intake door has already proved, so the product can offer one ordinary
 * decision instead of a second matcher.
 *
 * REPLACE is a product word for "use this update". Nothing here deletes a
 * batch, rewrites money, or mutates published prices.
 */

export const REIMPORT_CLASSIFICATIONS = [
  'EXACT_EXISTING',
  'INTERPRETATION_UPDATE',
  'SOURCE_UPDATE',
  'NEW_OR_UNPROVEN',
] as const;

export type ReimportClassification = (typeof REIMPORT_CLASSIFICATIONS)[number];

export type ReimportDifference = 'NONE' | 'READING' | 'SOURCE_CONTENT' | null;

export interface ReimportRelation {
  classification: ReimportClassification;
  existingBatchId: string | null;
  updateBatchId: string | null;
  difference: ReimportDifference;
}

export interface InterpretationIdentity {
  resourceNameColumn: number | null;
  sourceUnitColumn: number | null;
  declaredSection: string | null;
}

export function interpretationsDiffer(
  left: InterpretationIdentity,
  right: InterpretationIdentity,
): boolean {
  return (
    left.resourceNameColumn !== right.resourceNameColumn ||
    left.sourceUnitColumn !== right.sourceUnitColumn ||
    left.declaredSection !== right.declaredSection
  );
}

/**
 * HOW A COMPARABLE INTERPRETATION SIBLING IS CHOSEN WHEN MORE THAN ONE EXISTS.
 *
 * Newest `createdAt` first; equal times break on `id` descending. The database
 * query and the in-memory selector share this array so a harness that ignores
 * `orderBy` cannot silently pick insertion order.
 */
export const INTERPRETATION_SIBLING_ORDER_BY = [
  { createdAt: 'desc' as const },
  { id: 'desc' as const },
];

export interface InterpretationSiblingCandidate extends InterpretationIdentity {
  id: string;
  createdAt: Date;
}

function compareInterpretationSiblings(
  left: Pick<InterpretationSiblingCandidate, 'id' | 'createdAt'>,
  right: Pick<InterpretationSiblingCandidate, 'id' | 'createdAt'>,
): number {
  const byCreated = right.createdAt.getTime() - left.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

/**
 * First comparable sibling under INTERPRETATION_SIBLING_ORDER_BY whose
 * reading differs from the incoming one. Same-reading rows are skipped —
 * those are exact-replay territory, not an interpretation update.
 */
export function selectInterpretationSibling(
  siblings: ReadonlyArray<InterpretationSiblingCandidate>,
  incoming: InterpretationIdentity,
): string | null {
  return (
    [...siblings].sort(compareInterpretationSiblings).find((sibling) =>
      interpretationsDiffer(incoming, {
        resourceNameColumn: sibling.resourceNameColumn,
        sourceUnitColumn: sibling.sourceUnitColumn,
        declaredSection: sibling.declaredSection,
      }),
    )?.id ?? null
  );
}

/**
 * Priority is the product law, not taste:
 *
 *   exact owned replay          → EXACT_EXISTING
 *   same bytes, different reading → INTERPRETATION_UPDATE
 *   proven same source stream,
 *     different bytes           → SOURCE_UPDATE
 *   anything else               → NEW_OR_UNPROVEN
 *
 * Filename, display name and similarity are deliberately absent from this
 * input. They are never proof.
 */
export function classifyReimport(facts: {
  exactOwnedBatchId: string | null;
  interpretationSiblingId: string | null;
  sourceStreamSiblingId: string | null;
  incomingBatchId: string;
}): ReimportRelation {
  if (facts.exactOwnedBatchId) {
    return {
      classification: 'EXACT_EXISTING',
      existingBatchId: facts.exactOwnedBatchId,
      updateBatchId: null,
      difference: 'NONE',
    };
  }
  if (facts.interpretationSiblingId) {
    return {
      classification: 'INTERPRETATION_UPDATE',
      existingBatchId: facts.interpretationSiblingId,
      updateBatchId: facts.incomingBatchId,
      difference: 'READING',
    };
  }
  if (facts.sourceStreamSiblingId) {
    return {
      classification: 'SOURCE_UPDATE',
      existingBatchId: facts.sourceStreamSiblingId,
      updateBatchId: facts.incomingBatchId,
      difference: 'SOURCE_CONTENT',
    };
  }
  return {
    classification: 'NEW_OR_UNPROVEN',
    existingBatchId: null,
    updateBatchId: null,
    difference: null,
  };
}

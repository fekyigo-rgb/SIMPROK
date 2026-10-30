import {
  sameSourceObservationPredecessorId,
  type BasicPriceProvenHistory,
  type BasicPriceProvenHistoryEntry,
} from '../common/basic-price-workflow.projection';

/**
 * BP-HISTORY-ONE-TRUTH: presentation of ONLY proven canonical relationships.
 * This is not a second price-selection engine and never changes stored facts.
 * A correction names its predecessor through supersedesBasicPriceId; a later
 * same-source observation names it through the existing provenance birth audit.
 * Similar descriptions, prices, or nearby dates NEVER create a relationship.
 */
export const BASIC_PRICE_PROVEN_HISTORY_MAX_CANDIDATES = 500;

export interface ProvenHistoryRow {
  id: string;
  workspaceId: string | null;
  assetScope: string;
  recordsNewObservation: boolean;
  sourceOrigin: string;
  sourceType: string;
  resourceId: string;
  regionId: string | null;
  regionCoverageSetId: string | null;
  supersedesBasicPriceId: string | null;
  createdAt: Date;
  effectiveDate: Date;
  price: string;
  sourceName: string | null;
  provenanceCorrections?: ReadonlyArray<{
    before: unknown;
    after: unknown;
  }> | null;
}

function lawfulPrivateObservationEdge(
  descendant: ProvenHistoryRow,
  predecessor: ProvenHistoryRow,
): boolean {
  return (
    descendant.assetScope === 'WORKSPACE_PRIVATE' &&
    descendant.recordsNewObservation === true &&
    predecessor.assetScope === 'WORKSPACE_PRIVATE' &&
    descendant.workspaceId !== null &&
    descendant.workspaceId === predecessor.workspaceId &&
    descendant.resourceId === predecessor.resourceId &&
    descendant.regionId === predecessor.regionId &&
    descendant.regionCoverageSetId === predecessor.regionCoverageSetId
  );
}

/**
 * Follow EXACT recorded edges from the selected, currently offered price.
 * No forward guessing: an as-of historical Detail never includes later facts.
 * An unavailable predecessor stops the chain and suppresses any claim that
 * the oldest visible row is the first recorded price.
 */
export function buildProvenPriceHistory(
  anchorId: string,
  rows: readonly ProvenHistoryRow[],
  candidateSetCapped = false,
  anchorCurrentAtSelectedDate = true,
): BasicPriceProvenHistory {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const entries: BasicPriceProvenHistoryEntry[] = [];
  const provedPrivateSourceEdges: boolean[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(anchorId);
  // An eligible anchor omitted by a bounded search is NOT proof of
  // "no history"; the caller must report the incomplete read.
  let truncated = candidateSetCapped || !cursor;
  while (cursor && entries.length < BASIC_PRICE_PROVEN_HISTORY_MAX_CANDIDATES) {
    if (visited.has(cursor.id)) {
      truncated = true;
      break;
    }
    visited.add(cursor.id);

    const correctionParent = cursor.supersedesBasicPriceId;
    const observationParent = correctionParent
      ? null
      : sameSourceObservationPredecessorId(cursor.provenanceCorrections?.[0]);
    const parentId = correctionParent ?? observationParent;
    const candidate = parentId ? byId.get(parentId) : undefined;
    const permittedParent =
      candidate &&
      (correctionParent
        ? candidate.resourceId === cursor.resourceId &&
          candidate.regionId === cursor.regionId &&
          candidate.regionCoverageSetId === cursor.regionCoverageSetId &&
          candidate.assetScope === cursor.assetScope &&
          candidate.workspaceId === cursor.workspaceId &&
          candidate.sourceType === cursor.sourceType &&
          candidate.sourceOrigin === cursor.sourceOrigin &&
          candidate.effectiveDate.getTime() === cursor.effectiveDate.getTime()
        : lawfulPrivateObservationEdge(cursor, candidate))
        ? candidate
        : undefined;
    if (parentId && !permittedParent) truncated = true;

    const actionLabel = correctionParent
      ? ('Dikoreksi' as const)
      : observationParent
        ? ('Diperbarui' as const)
        : ('Harga Awal' as const);
    // The ROOT has no persisted predecessor; absent parents are not roots.
    const sourceIdentityIsProven = Boolean(
      permittedParent &&
      cursor.assetScope === 'WORKSPACE_PRIVATE' &&
      permittedParent.assetScope === 'WORKSPACE_PRIVATE' &&
      cursor.workspaceId === permittedParent.workspaceId &&
      (correctionParent
        ? cursor.sourceOrigin === permittedParent.sourceOrigin &&
          cursor.sourceType === permittedParent.sourceType
        : true),
    );
    const sourceName =
      cursor.sourceName ||
      (sourceIdentityIsProven ? (permittedParent?.sourceName ?? null) : null);
    provedPrivateSourceEdges.push(sourceIdentityIsProven);
    entries.push({
      price: cursor.price,
      changeLabel:
        entries.length === 0 && anchorCurrentAtSelectedDate
          ? 'Terkini'
          : actionLabel,
      actionLabel,
      recordedAt: cursor.createdAt.toISOString(),
      sourceName,
      isCurrent: entries.length === 0 && anchorCurrentAtSelectedDate,
    });
    if (!parentId || !permittedParent) break;
    cursor = permittedParent;
  }
  // A name can be inherited only across the exact, proven private
  // same-source chain. This is a presentation of the source identity,
  // NEVER a claim that the earlier document proves the newer price.
  for (let i = entries.length - 2; i >= 0; i -= 1) {
    if (provedPrivateSourceEdges[i] && !entries[i].sourceName) {
      entries[i].sourceName = entries[i + 1].sourceName;
    }
  }
  if (cursor && entries.length >= BASIC_PRICE_PROVEN_HISTORY_MAX_CANDIDATES) {
    const oldest = entries[entries.length - 1];
    if (oldest && oldest.actionLabel !== 'Harga Awal') truncated = true;
  }
  return { entries, truncated };
}

/**
 * AHSP document knowledge — the trust object BETWEEN SourceTable and the
 * existing canonical writer. Nothing here is a persisted AHSP. A fact without
 * a locator is not a fact.
 */

import type { AhspIdentityMatch, AhspIdentityVerdict } from './ahsp-identity-classifier';

export const AHSP_DOCUMENT_CONTRACT_VERSION = 'AHSP_DOCUMENT_USI01_V1';

export const AHSP_DOCUMENT_REASON = {
  SOURCE_UNREADABLE: 'SOURCE_UNREADABLE',
  STRUCTURE_UNSUPPORTED: 'STRUCTURE_UNSUPPORTED',
  SEMANTIC_AMBIGUITY: 'SEMANTIC_AMBIGUITY',
  MISSING_WORK_ITEM: 'MISSING_WORK_ITEM',
  MISSING_RESOURCE: 'MISSING_RESOURCE',
  MISSING_UNIT: 'MISSING_UNIT',
  MISSING_OUTPUT_UNIT: 'MISSING_OUTPUT_UNIT',
  /**
   * The document states the output unit more than once, in different spellings (a
   * title "1 m2 …" over a summary "per - m3"). Every statement is kept; none is
   * chosen. Never MISSING_OUTPUT_UNIT: the unit is stated, twice. Cleared at
   * resolution only when the Unit Kernel proves every spelling names one unit.
   */
  SOURCE_UNIT_CONFLICT: 'SOURCE_UNIT_CONFLICT',
  INVALID_COEFFICIENT: 'INVALID_COEFFICIENT',
  RESOURCE_UNRESOLVED: 'RESOURCE_UNRESOLVED',
  RESOURCE_CANDIDATES_FOUND: 'RESOURCE_CANDIDATES_FOUND',
  UNIT_UNRESOLVED: 'UNIT_UNRESOLVED',
  AUTHORITY_UNPROVEN: 'AUTHORITY_UNPROVEN',
  CURRENTNESS_UNPROVEN: 'CURRENTNESS_UNPROVEN',
  DUPLICATE_IDENTITY: 'DUPLICATE_IDENTITY',
  /** An existing AHSP may be the same work — surfaced for a human decision, never auto-actioned. */
  IDENTITY_POSSIBLE_MATCH: 'IDENTITY_POSSIBLE_MATCH',
} as const;

export type AhspDocumentReasonCode =
  (typeof AHSP_DOCUMENT_REASON)[keyof typeof AHSP_DOCUMENT_REASON];

export type AhspKnowledgeStatus = 'READY' | 'UNRESOLVED';

/**
 * IMPORT-SEAM-01 — what an understood work item may become, decided from the
 * resolution alone: never from a person, never from similarity.
 *
 *  PROVEN            every fact the recipe needs is proved (today's READY).
 *  IDENTITY_PENDING  the recipe is whole — both names, a proved output unit, and
 *                    every component's name, class, coefficient and proved unit —
 *                    and the ONLY open question is which catalogue resource a
 *                    component is. Written with the source's own wording for that
 *                    component; pricing stays gated where identity is required.
 *  HELD              a fact the recipe needs is missing, invalid, unproved,
 *                    contradictory or awaiting a decision. Kept, never written,
 *                    never lost.
 */
export type AhspWorkItemAdmission = 'PROVEN' | 'IDENTITY_PENDING' | 'HELD';

export type AhspResourceGroup = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

export interface AhspSourceLocator {
  readonly sheetName: string;
  readonly locator: string;
  /**
   * The source row this fact was read from. Carried so an observation this
   * document produces can be admitted later: the shared canonical memory
   * (ResourceSourceIdentity) is keyed on the source row.
   */
  readonly rowNumber: number;
  readonly raw: string;
}

export interface AhspResourceKnowledge {
  readonly status: AhspKnowledgeStatus;
  readonly reasonCodes: readonly AhspDocumentReasonCode[];
  readonly group: AhspResourceGroup | null;
  readonly rawName: string | null;
  readonly rawCode: string | null;
  readonly rawUnit: string | null;
  readonly coefficient: number | null;
  readonly nameEvidence: AhspSourceLocator | null;
  readonly codeEvidence: AhspSourceLocator | null;
  readonly unitEvidence: AhspSourceLocator | null;
  readonly coefficientEvidence: AhspSourceLocator | null;
  readonly resolvedResourceCatalogId: string | null;
  readonly resolvedBaseUnit: string | null;
  /**
   * Catalog names the existing Resource Identity kernel already found.
   * Never an asserted identity. Empty when investigation produced none.
   */
  readonly identityCandidates?: readonly string[];
  /**
   * ACG-01.1 — true when the names above are rows the kernel RULED OUT (its
   * verdict was UNRESOLVED: a stated specification conflict or a class
   * mismatch). Found and examined, so still "found something" — but never a
   * possible match, and never a judgement on this source resource, which stays
   * accepted. Absent whenever the names were nominated (or none were found), so
   * every other reading is byte-for-byte what it was.
   */
  readonly identityCandidatesRuledOut?: true;
  /**
   * IQL-01 — the APPROVE event whose exact-question answer settled this
   * identity, when (and only when) that is how it was settled. Present so such
   * a reading is never written into the case-insensitive sighting memory, and
   * so a committed analysis can say which governed answer it relied on.
   */
  readonly identicalQuestionDecisionId?: string | null;
}

export interface AhspWorkItemKnowledge {
  readonly status: AhspKnowledgeStatus;
  readonly reasonCodes: readonly AhspDocumentReasonCode[];
  readonly workType: AhspSourceLocator | null;
  readonly methodName: AhspSourceLocator | null;
  readonly outputUnitRaw: AhspSourceLocator | null;
  /**
   * Every place the block states its output unit, in precedence order — the
   * "Harga Satuan Pekerjaan per -" summary, a "satuan :" row, the work title —
   * present only when it states it in more than one place. Agreement keeps the
   * first as `outputUnitRaw`; a conflict keeps them all and `outputUnitRaw` null.
   */
  readonly outputUnitStatements?: readonly AhspSourceLocator[];
  readonly resolvedOutputUnit: string | null;
  readonly regulationReference: AhspSourceLocator | null;
  readonly effectiveDate: string | null;
  readonly sheetName: string;
  readonly resources: readonly AhspResourceKnowledge[];
  /**
   * AHSP-WHOLE identity comparison against what SIMPROK already holds. Optional
   * and additive: absent (or DISTINCT) means nothing to decide, and the reader
   * sees exactly what it saw before. IDENTICAL/POSSIBLY_IDENTICAL carry the
   * matched AHSP(s) as EVIDENCE for a human decision — never an auto-action.
   */
  readonly identityVerdict?: AhspIdentityVerdict;
  readonly identityMatches?: readonly AhspIdentityMatch[];
  /**
   * IMPORT-SEAM-01 — set by resolution, absent on knowledge that was only
   * understood. `status` keeps its meaning: READY still means every fact proved.
   */
  readonly admission?: AhspWorkItemAdmission;
}

export interface AhspDocumentKnowledge {
  readonly contractVersion: string;
  readonly source: {
    readonly fileName: string;
    readonly contentDigestSha256: string;
    readonly readerId: string;
    readonly readerContractVersion: string;
    readonly byteSize: number;
  };
  readonly document: {
    readonly title: AhspSourceLocator | null;
    readonly regulationReference: AhspSourceLocator | null;
    readonly effectiveDate: string | null;
    readonly authorityProven: boolean;
  };
  readonly status: AhspKnowledgeStatus | 'STRUCTURE_UNSUPPORTED';
  readonly reasonCodes: readonly AhspDocumentReasonCode[];
  readonly workItems: readonly AhspWorkItemKnowledge[];
}

/**
 * AHSP document knowledge — the trust object BETWEEN SourceTable and the
 * existing canonical writer. Nothing here is a persisted AHSP. A fact without
 * a locator is not a fact.
 */

export const AHSP_DOCUMENT_CONTRACT_VERSION = 'AHSP_DOCUMENT_USI01_V1';

export const AHSP_DOCUMENT_REASON = {
  SOURCE_UNREADABLE: 'SOURCE_UNREADABLE',
  STRUCTURE_UNSUPPORTED: 'STRUCTURE_UNSUPPORTED',
  SEMANTIC_AMBIGUITY: 'SEMANTIC_AMBIGUITY',
  MISSING_WORK_ITEM: 'MISSING_WORK_ITEM',
  MISSING_RESOURCE: 'MISSING_RESOURCE',
  MISSING_UNIT: 'MISSING_UNIT',
  INVALID_COEFFICIENT: 'INVALID_COEFFICIENT',
  RESOURCE_UNRESOLVED: 'RESOURCE_UNRESOLVED',
  UNIT_UNRESOLVED: 'UNIT_UNRESOLVED',
  AUTHORITY_UNPROVEN: 'AUTHORITY_UNPROVEN',
  CURRENTNESS_UNPROVEN: 'CURRENTNESS_UNPROVEN',
  DUPLICATE_IDENTITY: 'DUPLICATE_IDENTITY',
} as const;

export type AhspDocumentReasonCode =
  (typeof AHSP_DOCUMENT_REASON)[keyof typeof AHSP_DOCUMENT_REASON];

export type AhspKnowledgeStatus = 'READY' | 'UNRESOLVED';

export type AhspResourceGroup = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';

export interface AhspSourceLocator {
  readonly sheetName: string;
  readonly locator: string;
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
}

export interface AhspWorkItemKnowledge {
  readonly status: AhspKnowledgeStatus;
  readonly reasonCodes: readonly AhspDocumentReasonCode[];
  readonly workType: AhspSourceLocator | null;
  readonly methodName: AhspSourceLocator | null;
  readonly outputUnitRaw: AhspSourceLocator | null;
  readonly resolvedOutputUnit: string | null;
  readonly regulationReference: AhspSourceLocator | null;
  readonly effectiveDate: string | null;
  readonly sheetName: string;
  readonly resources: readonly AhspResourceKnowledge[];
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

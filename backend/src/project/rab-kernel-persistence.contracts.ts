export const RAB_KERNEL_PERSISTENCE_POLICY = 'RAB_KERNEL_PERSISTENCE_GRADE_A_V1' as const;

/**
 * Reason codes specific to the Gate-2A persist command's pre-kernel
 * validation (project/draft/occurrence/as-of-date). Kernel-internal
 * failures (unit mismatch, invalid volume, etc.) surface the existing
 * COST_CALCULATION_REASON codes from cost-kernel.contracts.ts unchanged —
 * this file never redefines them.
 */
export const RAB_KERNEL_PERSISTENCE_REASON = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  WORKING_DRAFT_NOT_FOUND: 'WORKING_DRAFT_NOT_FOUND',
  BOQ_ITEM_NOT_FOUND: 'BOQ_ITEM_NOT_FOUND',
  OCCURRENCE_NOT_FOUND: 'OCCURRENCE_NOT_FOUND',
  AMBIGUOUS_OCCURRENCE: 'AMBIGUOUS_OCCURRENCE',
  EMPTY_RESOURCES: 'EMPTY_RESOURCES',
  UNRESOLVED_RESOURCE: 'UNRESOLVED_RESOURCE',
  MISSING_ADAPTED_PRICE: 'MISSING_ADAPTED_PRICE',
  SELECTED_BASIC_PRICE_NOT_ELIGIBLE: 'SELECTED_BASIC_PRICE_NOT_ELIGIBLE',
  BASIC_PRICE_NOT_YET_EFFECTIVE: 'BASIC_PRICE_NOT_YET_EFFECTIVE',
  BASIC_PRICE_EXPIRED: 'BASIC_PRICE_EXPIRED',
  BASIC_PRICE_VALUE_DRIFTED: 'BASIC_PRICE_VALUE_DRIFTED',
  /**
   * §PR57 Gap A: the resolution's own resourceCatalogId is null, or the
   * freshly re-read BasicPrice's resourceId does not equal it. A RESOLVED
   * resolution must never consume a price belonging to a different
   * resource, even when every other check (eligibility, date, drift,
   * traceability) passes. Checked by exact id equality only — no name
   * matching, no fuzzy matching, no remap.
   */
  BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH: 'BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH',
  /**
   * §3.3 traceable Basic Price runtime gate: the selected BasicPrice cannot
   * be traced end-to-end through PriceSubmission -> PriceSubmissionReview ->
   * an ACCEPT decision with a resolvable verifier identity -> a PUBLISH
   * BasicPricePublicationAudit with a resolvable publisher identity distinct
   * from the verifier. One stable reason for every missing link — never
   * inferred from status fields alone.
   */
  BASIC_PRICE_PROVENANCE_INCOMPLETE: 'BASIC_PRICE_PROVENANCE_INCOMPLETE',
  /**
   * §5.1: the target line's own calculation succeeded, but at least one
   * other WORK_ITEM in the same Working Draft is still unpriced. The whole
   * command fails closed and rolls back — Gate 2A never persists a partial
   * line/partial total split across two truths.
   */
  RAB_TOTAL_INCOMPLETE: 'RAB_TOTAL_INCOMPLETE',
} as const;

export type RabKernelPersistenceReason =
  (typeof RAB_KERNEL_PERSISTENCE_REASON)[keyof typeof RAB_KERNEL_PERSISTENCE_REASON];

/**
 * saveDraftBoq protection conflict reasons — thrown when an incoming draft
 * row would silently corrupt or discard a SERVER_COST_KERNEL row's
 * authority. Gate-2A locked contract #8/#9: reject, never silently
 * downgrade or overwrite.
 */
export const SERVER_ROW_PROTECTION_REASON = {
  SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN:
    'SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN',
  SERVER_ROW_INPUT_CHANGED_REQUIRES_RECALCULATION:
    'SERVER_ROW_INPUT_CHANGED_REQUIRES_RECALCULATION',
  /** §4.1: an existing SERVER_COST_KERNEL row's id never appeared as a tempId. */
  SERVER_ROW_OMISSION_REQUIRES_EXPLICIT_COMMAND:
    'SERVER_ROW_OMISSION_REQUIRES_EXPLICIT_COMMAND',
  /** §4.1: an existing SERVER_COST_KERNEL row's id appeared as more than one tempId. */
  SERVER_ROW_DUPLICATE_REFERENCE_FORBIDDEN:
    'SERVER_ROW_DUPLICATE_REFERENCE_FORBIDDEN',
  /** §4.1: two or more incoming rows share the same tempId, full stop. */
  DUPLICATE_TEMP_ID: 'DUPLICATE_TEMP_ID',
} as const;

export type ServerRowProtectionReason =
  (typeof SERVER_ROW_PROTECTION_REASON)[keyof typeof SERVER_ROW_PROTECTION_REASON];

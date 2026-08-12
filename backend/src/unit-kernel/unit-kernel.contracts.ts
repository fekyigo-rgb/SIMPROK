export const UNIT_RESOLUTION_STATUS = {
  RESOLVED: 'RESOLVED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  NOT_CONVERTIBLE: 'NOT_CONVERTIBLE',
} as const;
export type UnitResolutionStatus = typeof UNIT_RESOLUTION_STATUS[keyof typeof UNIT_RESOLUTION_STATUS];

/**
 * The trusted facts a caller may use to disambiguate one raw unit spelling that
 * legitimately denotes more than one canonical unit.
 *
 * The values are exactly Prisma's `ResourceType`. That is deliberate: context
 * must come from a governed classification the system already holds about the
 * resource, never from reading a resource NAME. "Excavator" and "Pekerja" are
 * text; ResourceCatalog.type is a fact.
 *
 * Passing no context is always legal and always fail-closed: an ambiguous raw
 * alias stays ambiguous rather than defaulting to whichever row is found first.
 */
export const UNIT_ALIAS_CONTEXT = {
  MATERIAL: 'MATERIAL',
  LABOR: 'LABOR',
  EQUIPMENT: 'EQUIPMENT',
} as const;
export type UnitAliasContext =
  (typeof UNIT_ALIAS_CONTEXT)[keyof typeof UNIT_ALIAS_CONTEXT];

export const UNIT_REASON = {
  EXACT_UNIT_IDENTITY: 'EXACT_UNIT_IDENTITY',
  EXACT_UNIT_ALIAS_EQUIVALENCE: 'EXACT_UNIT_ALIAS_EQUIVALENCE',
  /** The resolution used a context-scoped alias, so it holds only in that context. */
  CONTEXT_SCOPED_UNIT_ALIAS: 'CONTEXT_SCOPED_UNIT_ALIAS',
  /**
   * The spelling IS known, but every mapping for it is context-scoped and the
   * caller supplied no context. Distinct from UNKNOWN_UNIT_ALIAS on purpose:
   * "I need to be told which context" is a different fact from "I have never
   * heard of this unit", and only the first one is fixed by passing context.
   */
  CONTEXT_REQUIRED_UNIT_ALIAS: 'CONTEXT_REQUIRED_UNIT_ALIAS',
  UNKNOWN_UNIT_ALIAS: 'UNKNOWN_UNIT_ALIAS',
  AMBIGUOUS_UNIT_ALIAS: 'AMBIGUOUS_UNIT_ALIAS',
  UNIQUE_EVIDENCE_BOUND_RULE: 'UNIQUE_EVIDENCE_BOUND_RULE',
  AMBIGUOUS_CONVERSION_RULE: 'AMBIGUOUS_CONVERSION_RULE',
  CONVERSION_RULE_NOT_FOUND: 'CONVERSION_RULE_NOT_FOUND',
  PACKAGE_EVIDENCE_REQUIRED: 'PACKAGE_EVIDENCE_REQUIRED',
  RESOURCE_SCOPE_MISMATCH: 'RESOURCE_SCOPE_MISMATCH',
  INVALID_QUANTITY_FACTOR: 'INVALID_QUANTITY_FACTOR',
  NOT_CONVERTIBLE: 'NOT_CONVERTIBLE',
  AHSP_OUTPUT_UNIT_UNRESOLVED: 'AHSP_OUTPUT_UNIT_UNRESOLVED',
  BOQ_UNIT_INCOMPATIBLE: 'BOQ_UNIT_INCOMPATIBLE',
} as const;
export type UnitReasonCode = typeof UNIT_REASON[keyof typeof UNIT_REASON];

export const UNIT_PRICE_OPERATION = {
  IDENTITY: 'IDENTITY',
  DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
} as const;

export const UNIT_KERNEL_POLICY_VERSION = 'KAMUS_UNIT_KERNEL_01A_V1' as const;

export interface ResolvedUnitIdentity {
  id: string;
  code: string;
  dimension: string;
}

export interface UnitResolutionResult {
  status: UnitResolutionStatus;
  rawSourceUnit: string;
  rawTargetUnit: string;
  sourceUnitDefinition: ResolvedUnitIdentity | null;
  targetUnitDefinition: ResolvedUnitIdentity | null;
  matchedSourceAliasIds: string[];
  matchedTargetAliasIds: string[];
  conversionRuleId: string | null;
  conversionRuleVersion: number | null;
  quantityFactor: string | null;
  conversionType: string | null;
  priceOperation: typeof UNIT_PRICE_OPERATION[keyof typeof UNIT_PRICE_OPERATION] | null;
  reasonCodes: UnitReasonCode[];
  explanation: string;
  policyVersion: typeof UNIT_KERNEL_POLICY_VERSION;
}

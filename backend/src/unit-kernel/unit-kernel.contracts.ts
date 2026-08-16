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
  /**
   * The spelling IS known to the alias table, but every meaning it has belongs
   * to a DIFFERENT governed context than the one the caller supplied.
   *
   * Distinct from UNKNOWN_UNIT_ALIAS, and the distinction is the whole point:
   * "Jm" catalogued only for EQUIPMENT, asked about under MATERIAL, is not an
   * unheard-of spelling — SIMPROK knows it perfectly well and knows it does not
   * apply here. Reporting that as "unknown" told the reviewer a false story
   * about what the system knows.
   *
   * DIAGNOSTIC ONLY, and deliberately so. It reports the same NOT PROVEN verdict
   * UNKNOWN_UNIT_ALIAS reports — a foreign-context alias stays ineligible and
   * never falls back to a context-free meaning. It changes what is SAID, never
   * what is ALLOWED.
   */
  FOREIGN_CONTEXT_UNIT_ALIAS: 'FOREIGN_CONTEXT_UNIT_ALIAS',
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

/**
 * RM-03D2 — what canonical unit ONE raw spelling denotes, and nothing else.
 *
 * This is deliberately a smaller question than `UnitResolutionResult`. It asks
 * "which UnitDefinition is this spelling?", never "can this unit be carried
 * across to that one?". No conversion rule is read to answer it, so a caller
 * cannot accidentally turn convertibility into an identity claim.
 *
 * RESOLVED means exactly one active alias survived the eligibility law.
 * NEEDS_REVIEW carries WHY — unknown spelling, several meanings, or a meaning
 * that exists only inside a context the caller did not supply. All three mean
 * NOT PROVEN; none of them ever means "proven different".
 */
export interface CanonicalUnitIdentity {
  /** Echoed verbatim, so a fact can never be read against the wrong spelling. */
  rawUnit: string;
  status: typeof UNIT_RESOLUTION_STATUS.RESOLVED | typeof UNIT_RESOLUTION_STATUS.NEEDS_REVIEW;
  unitDefinition: ResolvedUnitIdentity | null;
  /**
   * The alias rows that actually decided this answer, in a CANONICAL ORDER.
   *
   * Sorted rather than returned in database order on purpose: these ids travel
   * onward as provenance, and a provenance record whose contents depend on which
   * order Postgres happened to return rows in is not the same evidence twice.
   * Alias identity is a set here, so its serialization must be too.
   */
  matchedAliasIds: string[];
  /** True when a context-scoped alias answered — the meaning holds only there. */
  contextScoped: boolean;
  /**
   * The trusted context this answer actually DEPENDED ON, or null when it did
   * not depend on one.
   *
   * Not simply an echo of the context the caller passed. A caller may supply
   * LABOR and still be answered by a context-free alias, and recording LABOR
   * there would manufacture a dependency that never existed — claiming the
   * meaning is narrower than it is. So this is populated only when a
   * context-scoped alias carried the answer, which is exactly when the alias
   * eligibility law required `alias.context === context`.
   */
  resolvedContext: UnitAliasContext | null;
  reasonCode: UnitReasonCode;
  policyVersion: typeof UNIT_KERNEL_POLICY_VERSION;
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

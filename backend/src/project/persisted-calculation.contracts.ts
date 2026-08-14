import { COST_CALCULATION_POLICY, CostCalculationReason } from './cost-kernel.contracts';

/**
 * RM-03 — read-only re-proof of an already-persisted SERVER_COST_KERNEL line.
 *
 * GATE-2A proved that a server-computed RAB line can be written with truthful
 * provenance. It did not prove that the written line can still be re-derived
 * from its own frozen provenance after the page is closed and hard-reloaded.
 * That last link is what this contract serves: given nothing but a BoqItem id,
 * re-walk BoqItem -> calculationOccurrence -> resourceResolutions, re-run the
 * SAME pure Cost Kernel over those frozen rows, and report whether the
 * recomputed money is bit-for-bit the stored money.
 *
 * This path NEVER writes. It is a mirror, not a recalculation command: it must
 * not repair, refresh, re-resolve, or re-price anything. If stored and
 * recomputed disagree, that disagreement is the finding and must be reported
 * honestly as MISMATCH — never smoothed over, never auto-corrected.
 */
export const PERSISTED_CALCULATION_STATUS = {
  /** Recomputation reproduced the stored money exactly. */
  VERIFIED: 'VERIFIED',
  /**
   * The line and its provenance are intact and the kernel produced a result,
   * but that result is not equal to what is stored. This is an integrity
   * alarm, never a reason to overwrite the stored row.
   */
  MISMATCH: 'MISMATCH',
  /** The line cannot be re-proved at all — reason carries why. */
  FAIL_CLOSED: 'FAIL_CLOSED',
} as const;

export type PersistedCalculationStatus =
  (typeof PERSISTED_CALCULATION_STATUS)[keyof typeof PERSISTED_CALCULATION_STATUS];

export const PERSISTED_CALCULATION_REASON = {
  BOQ_ITEM_NOT_FOUND: 'BOQ_ITEM_NOT_FOUND',
  /** priceOrigin is NULL (unpriced) — nothing was ever server-calculated. */
  NOT_CALCULATED: 'NOT_CALCULATED',
  /** priceOrigin is MANUAL_CLIENT — a human price, which has no kernel to re-run. */
  MANUAL_PRICE_NOT_REPROVABLE: 'MANUAL_PRICE_NOT_REPROVABLE',
  /**
   * priceOrigin is SERVER_COST_KERNEL but the cited occurrence is not
   * reachable within this project/workspace. The Gate-2A truth constraint and
   * the RESTRICT foreign key make this unreachable through normal operation;
   * if it is ever seen, the row's provenance has been broken out-of-band.
   */
  CALCULATION_OCCURRENCE_MISSING: 'CALCULATION_OCCURRENCE_MISSING',
  /** Stored money columns are null on a SERVER_COST_KERNEL row (constraint violation). */
  STORED_MONEY_MISSING: 'STORED_MONEY_MISSING',
  /** The kernel itself refused to produce a result — inner reason is carried. */
  RECOMPUTATION_FAIL_CLOSED: 'RECOMPUTATION_FAIL_CLOSED',
} as const;

export type PersistedCalculationReason =
  (typeof PERSISTED_CALCULATION_REASON)[keyof typeof PERSISTED_CALCULATION_REASON];

/**
 * One AHSP resource as it was frozen at persist time, plus the resource cost
 * re-derived from those frozen numbers. `resourceCost` is deliberately NOT a
 * stored column anywhere in the schema — it is recomputed here as
 * coefficient x adaptedPriceValue so that the breakdown a human reads is
 * always the arithmetic actually being asserted, never a second copy that
 * could silently drift from it.
 */
export interface PersistedCalculationResource {
  resolutionId: string;
  ahspResourceId: string;
  /** Resource name as written in the AHSP source document. */
  rawAhspResourceRef: string;
  rawAhspResourceType: string;
  /** Canonical catalog identity the raw reference resolved to. */
  resourceCatalogId: string | null;
  resourceCatalogName: string | null;
  coefficient: string;
  ahspUnit: string;
  /** The canonical Basic Price this resource was priced from. */
  selectedBasicPriceId: string | null;
  sourcePriceValue: string | null;
  sourceUnit: string | null;
  adaptedPriceValue: string | null;
  canonicalUnit: string | null;
  quantityFactor: string | null;
  selectedSourceOrigin: string | null;
  selectedFreshnessStatus: string | null;
  selectedEffectiveDate: string | null;
  status: string;
  resolutionMethod: string;
  reasonCodes: string[];
  explanation: string;
  policyVersion: string;
  /** coefficient x adaptedPriceValue, exact decimal, recomputed on read. */
  resourceCost: string;
}

/** Everything a human needs to answer "where did this number come from?". */
export interface PersistedCalculationProvenance {
  calculationOccurrenceId: string;
  ahspVersionId: string;
  ahspOutputUnit: string;
  /** Business pricing date the line was priced as of. */
  calculationAsOfDate: string;
  calculatedAt: string;
  calculationPolicyVersion: string;
  /** Policy that governed resource resolution inside the occurrence. */
  resolutionPolicyVersion: string | null;
  referenceRegionId: string | null;
  referenceRegionName: string | null;
  occurrenceGeneration: number;
}

/** Exact-equality verdict per money field. No tolerance, no epsilon. */
export interface PersistedCalculationIntegrity {
  unitPriceMatches: boolean;
  lineTotalMatches: boolean;
  /** True when every resource produced a finite recomputed cost. */
  allResourceCostsReproduced: boolean;
}

export interface PersistedCalculationSuccess {
  status:
    | typeof PERSISTED_CALCULATION_STATUS.VERIFIED
    | typeof PERSISTED_CALCULATION_STATUS.MISMATCH;
  boqItemId: string;
  priceOrigin: 'SERVER_COST_KERNEL';
  /**
   * RAB-TRUTH-CLOSEOUT-01 — whose data formed this price. Running the Cost
   * Kernel proves SIMPROK did the arithmetic; it does not prove SIMPROK stands
   * behind the sources. These persisted facts let the reader tell "Auto
   * SIMPROK" from "Data Pengguna" without inferring anything.
   */
  sourceAuthority: {
    ahspOwnership: string | null;
    /**
     * THREE STATES, NOT TWO. `true` = the frozen ownership is authoritative;
     * `false` = it is proven non-authoritative (a user asset); `null` = the
     * historical ownership was never proven and must not be guessed either
     * way. A plain boolean collapsed "unknown" into "user data", which is a
     * claim the evidence does not support.
     */
    ahspAuthoritative: boolean | null;
    privateBasicPriceCount: number;
    catalogBasicPriceCount: number;
  };
  /** What the database holds right now. */
  stored: {
    volume: string;
    unit: string;
    unitPrice: string;
    lineTotal: string;
  };
  /** What re-running the kernel over the frozen provenance produces now. */
  recomputed: {
    unitPrice: string;
    lineTotal: string;
  };
  integrity: PersistedCalculationIntegrity;
  provenance: PersistedCalculationProvenance;
  resources: PersistedCalculationResource[];
  currency: 'IDR';
  calculationPolicy: typeof COST_CALCULATION_POLICY;
}

export interface PersistedCalculationFailure {
  status: typeof PERSISTED_CALCULATION_STATUS.FAIL_CLOSED;
  boqItemId: string;
  reason: PersistedCalculationReason;
  /** Present only when reason is RECOMPUTATION_FAIL_CLOSED. */
  kernelReason?: CostCalculationReason;
  currency: 'IDR';
  calculationPolicy: typeof COST_CALCULATION_POLICY;
}

export type PersistedCalculationResult =
  | PersistedCalculationSuccess
  | PersistedCalculationFailure;

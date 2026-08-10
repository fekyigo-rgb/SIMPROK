import { RAB_STATUS, type RabStatus } from './rab-lifecycle-policy.service';

export const RAB_LOCK_POLICY = 'RAB_LOCK_FREEZE_V1' as const;

/**
 * Why a lock command refused. Every one of these leaves the RAB exactly as it
 * was — LOCK never repairs, refreshes, or re-prices anything on its way in.
 */
export const RAB_LOCK_REASON = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  WORKING_DRAFT_NOT_FOUND: 'WORKING_DRAFT_NOT_FOUND',
  RAB_DOCUMENT_NOT_FOUND: 'RAB_DOCUMENT_NOT_FOUND',
  /** More than one Working Draft — which RAB to freeze is ambiguous, so none is. */
  AMBIGUOUS_WORKING_DRAFT: 'AMBIGUOUS_WORKING_DRAFT',
  /** Already APPROVED. Approval is downstream of lock and is never walked back. */
  RAB_ALREADY_APPROVED: 'RAB_ALREADY_APPROVED',
  /** Some other status this slice does not know how to freeze. */
  RAB_NOT_IN_LOCKABLE_STATE: 'RAB_NOT_IN_LOCKABLE_STATE',
  /** Nothing to freeze: a RAB with no work item is not a RAB anyone can be held to. */
  RAB_HAS_NO_WORK_ITEM: 'RAB_HAS_NO_WORK_ITEM',
  /**
   * The pre-lock revalidation found the draft is no longer the truth it
   * claims to be. The delta says what moved; refreshing it is a normal DRAFT
   * action, deliberately NOT something LOCK does for you.
   */
  PRELOCK_REVALIDATION_REQUIRED: 'PRELOCK_REVALIDATION_REQUIRED',
} as const;

export type RabLockReason = (typeof RAB_LOCK_REASON)[keyof typeof RAB_LOCK_REASON];

/** Why one specific line failed revalidation — always a fact, never a guess. */
export const PRELOCK_FINDING = {
  /** The row is a WORK_ITEM but carries no price at all. */
  UNPRICED_WORK_ITEM: 'UNPRICED_WORK_ITEM',
  /** Stored money and freshly recomputed money disagree. */
  CALCULATION_MISMATCH: 'CALCULATION_MISMATCH',
  /** The line cannot be re-proved at all (missing provenance, ineligible price, drift...). */
  CALCULATION_NOT_REPROVABLE: 'CALCULATION_NOT_REPROVABLE',
  /** A resource cost could not be reproduced from the frozen provenance. */
  RESOURCE_COST_NOT_REPRODUCED: 'RESOURCE_COST_NOT_REPRODUCED',
  /**
   * The AHSP version this line is priced against is no longer the eligible one
   * for its own calculation as-of date. Freezing it would freeze a superseded
   * basis.
   */
  AHSP_VERSION_NO_LONGER_ELIGIBLE: 'AHSP_VERSION_NO_LONGER_ELIGIBLE',
  /** The draft recap itself is not complete, so the total is not authoritative. */
  RAB_PRICING_INCOMPLETE: 'RAB_PRICING_INCOMPLETE',
} as const;

export type PrelockFinding = (typeof PRELOCK_FINDING)[keyof typeof PRELOCK_FINDING];

export interface PrelockLineFinding {
  boqItemId: string;
  wbsCode: string;
  name: string;
  finding: PrelockFinding;
  /** Free-form detail from the authority that produced the finding, verbatim. */
  detail?: string;
  storedUnitPrice?: string | null;
  currentUnitPrice?: string | null;
  storedLineTotal?: string | null;
  currentLineTotal?: string | null;
}

export interface RabLockSuccess {
  status: typeof RAB_STATUS.LOCKED;
  /** false when the RAB was already LOCKED — an idempotent no-op, not a second freeze. */
  changed: boolean;
  rabDocumentId: string;
  projectId: string;
  lockedAt: string;
  lockedByAccountId: string;
  lockedFromStatus: RabStatus | string;
  /** Exactly what was frozen, echoed back from the row — never recomputed here. */
  frozen: {
    workItemCount: number;
    totalBaseCost: string | null;
    totalFinalCost: string | null;
  };
  lockPolicy: typeof RAB_LOCK_POLICY;
}

export interface RabLockRefusal {
  status: 'REFUSED';
  reason: RabLockReason;
  /** Present only for PRELOCK_REVALIDATION_REQUIRED. */
  findings?: PrelockLineFinding[];
  lockPolicy: typeof RAB_LOCK_POLICY;
}

export type RabLockResult = RabLockSuccess | RabLockRefusal;

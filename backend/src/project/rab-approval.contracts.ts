import { RAB_STATUS, type RabStatus } from './rab-lifecycle-policy.service';

export const RAB_APPROVAL_POLICY = 'RAB_APPROVAL_BASELINE_V1' as const;

/**
 * PAB-03 — the GENERIC act, never a job title.
 *
 * `RAB_APPROVE` names "approving a RAB" and nothing else. SIMPROK does not
 * know, and must never learn, that PPK / Direktur / Owner / Ketua is the
 * approver: those are organizational configurations expressed as Positions,
 * and the platform reaches them only through
 *
 *   Position -> PositionAuthority -> Authority(code = RAB_APPROVE)
 *
 * PUPR may grant this authority to Position "PPK"; a company to "Direktur";
 * an individual to "Owner"; a committee to "Ketua". The product code below
 * branches on none of them — it asks the existing authority chain who holds
 * the act, and the answer is whatever that organization configured.
 *
 * The string is identical to the permission code by the SAME existing
 * convention the Progress domain already follows (Authority.code
 * 'FIELD_PROGRESS_VERIFY' alongside permission 'FIELD_PROGRESS_VERIFY').
 * They remain two different gates that happen to share a name: the
 * permission is the application gate, the Authority is organizational
 * legitimacy. Holding one never implies the other.
 */
export const RAB_APPROVAL_AUTHORITY = 'RAB_APPROVE' as const;

/**
 * The ApprovalMatrix `objectType` for this act. A workspace that configures
 * no row for it is governed by the authority chain alone; a workspace that
 * DOES configure rows has said "only these Positions, in these value bands"
 * and is obeyed. Neither behaviour invents a rule — it reads the columns
 * ApprovalMatrix already has.
 */
export const RAB_APPROVAL_OBJECT_TYPE = 'RAB_DOCUMENT' as const;

/**
 * Why an approval command refused. Every one of these leaves the RAB exactly
 * as it was — APPROVE never repairs, re-prices, unlocks or back-fills
 * anything on its way in, and never leaves a baseline behind.
 *
 * The first five deliberately reuse the RAB_LOCK_REASON spelling for the
 * identical situations, so one vocabulary describes the whole lifecycle.
 */
export const RAB_APPROVAL_REASON = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  WORKING_DRAFT_NOT_FOUND: 'WORKING_DRAFT_NOT_FOUND',
  RAB_DOCUMENT_NOT_FOUND: 'RAB_DOCUMENT_NOT_FOUND',
  AMBIGUOUS_WORKING_DRAFT: 'AMBIGUOUS_WORKING_DRAFT',
  /**
   * A row says LOCKED but cannot say who froze it, when, and from what.
   * Approving an unprovable freeze would make a baseline out of a fact
   * nobody performed.
   */
  RAB_LOCK_PROVENANCE_CORRUPT: 'RAB_LOCK_PROVENANCE_CORRUPT',
  /**
   * The RAB is not LOCKED. A DRAFT is not approvable — locking it is a
   * separate, earlier human act and APPROVE never performs it on the
   * Owner's behalf.
   */
  RAB_NOT_LOCKED: 'RAB_NOT_LOCKED',
  /** ONE ACTIVE BASELINE PER PROJECT. Another one already governs execution. */
  ACTIVE_BASELINE_EXISTS: 'ACTIVE_BASELINE_EXISTS',
  /**
   * The RAB is already APPROVED but carries no ACTIVE baseline — the exact
   * half-state this command's atomicity exists to prevent. SIMPROK reports
   * it rather than silently manufacturing the missing baseline, which would
   * date an execution reference to today and hide the integrity failure.
   */
  APPROVED_WITHOUT_ACTIVE_BASELINE: 'APPROVED_WITHOUT_ACTIVE_BASELINE',
  /**
   * This workspace configured ApprovalMatrix rows for RAB approval, and the
   * holder's Position is not one of them. The authority chain said "may
   * approve a RAB"; the matrix says "not this one".
   */
  APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED:
    'APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED',
  /** Configured rows exist for this Position, but none covers the RAB's value. */
  APPROVAL_MATRIX_VALUE_OUT_OF_BAND: 'APPROVAL_MATRIX_VALUE_OUT_OF_BAND',
  /**
   * A value band has to be compared against a number. A LOCKED RAB with no
   * final total cannot be placed in any band, so it fails closed instead of
   * being treated as zero.
   */
  RAB_TOTAL_UNKNOWN: 'RAB_TOTAL_UNKNOWN',
} as const;

export type RabApprovalReason =
  (typeof RAB_APPROVAL_REASON)[keyof typeof RAB_APPROVAL_REASON];

/** The one ACTIVE baseline this approval produced, echoed from the row written. */
export interface RabApprovalBaseline {
  id: string;
  projectId: string;
  rabDocumentId: string;
  versionNumber: number;
  status: 'ACTIVE';
  approvedAt: string;
  approvedByPositionId: string;
  justification: string | null;
}

export interface RabApprovalSuccess {
  status: typeof RAB_STATUS.APPROVED;
  /** false when the RAB was already APPROVED — idempotent, never a second approval. */
  changed: boolean;
  rabDocumentId: string;
  projectId: string;
  /** The Position that held the authority, not the person. Authority belongs to Position. */
  approvedByPositionId: string;
  approvedByPositionCode: string;
  authorityCode: typeof RAB_APPROVAL_AUTHORITY;
  baseline: RabApprovalBaseline;
  approvalPolicy: typeof RAB_APPROVAL_POLICY;
}

export interface RabApprovalRefusal {
  status: 'REFUSED';
  reason: RabApprovalReason;
  /** Present only for RAB_NOT_LOCKED — the state the RAB is actually in. */
  rabStatus?: RabStatus | string;
  approvalPolicy: typeof RAB_APPROVAL_POLICY;
}

export type RabApprovalResult = RabApprovalSuccess | RabApprovalRefusal;

/**
 * Why the approval door is not open for THIS reader right now. Read-only:
 * nothing here authorizes anything, and the command re-derives every one of
 * these facts inside its own transaction before writing.
 */
export const RAB_APPROVAL_GATE_BLOCKER = {
  /**
   * Nobody in this workspace holds RAB_APPROVE through any Position. This is
   * a GOVERNANCE blocker, not a permission denial: the organization has not
   * yet said who approves a RAB. UI must say exactly that, and must never
   * ask the reader to pick an approver — configuring a Position is
   * administration, performed in the authority area.
   */
  NO_CONFIGURED_AUTHORITY: 'NO_CONFIGURED_AUTHORITY',
  /**
   * Positions DO hold the authority, but this reader is not their current
   * holder on this project. The door is honest rather than hidden, and it
   * names the Positions that may act.
   */
  ACTOR_IS_NOT_HOLDER: 'ACTOR_IS_NOT_HOLDER',
  /** The reader holds the authority but lacks the RAB_APPROVE permission. */
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
} as const;

export type RabApprovalGateBlocker =
  (typeof RAB_APPROVAL_GATE_BLOCKER)[keyof typeof RAB_APPROVAL_GATE_BLOCKER];

/** A Position, named as the organization named it. SIMPROK invents no titles. */
export interface RabApprovalPositionSummary {
  id: string;
  code: string;
  name: string;
}

export interface RabApprovalGate {
  /** The RAB's own lifecycle state, or null when this project has no RAB yet. */
  rabStatus: RabStatus | string | null;
  rabDocumentId: string | null;
  /** True only when a real command would be attempted — never a promise it succeeds. */
  canApprove: boolean;
  /** Why not. null when canApprove is true. */
  blocker: RabApprovalGateBlocker | RabApprovalReason | null;
  /** Which Positions the EXISTING governance says may perform this act. */
  authorizedPositions: RabApprovalPositionSummary[];
  /** The Position this reader currently holds for the act, when they hold one. */
  holderPositionId: string | null;
  activeBaselineCount: number;
  authorityCode: typeof RAB_APPROVAL_AUTHORITY;
  approvalPolicy: typeof RAB_APPROVAL_POLICY;
}

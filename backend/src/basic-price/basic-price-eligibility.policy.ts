import { Injectable } from '@nestjs/common';
import { Prisma, PriceVerificationStatus } from '@prisma/client';

/**
 * Single source of truth for "publicly eligible" — OWNER-LOCKED, unchanged
 * from the predicate basic-price.service.ts already enforced before this
 * policy existed (see 01-RM02B0-SCHEMA-CONTRACT.md §10 and §1.4's
 * BASIC_PRICE_PUBLIC_API_RULE = BASIC_PRICE_AHSP_RESOLUTION_RULE =
 * BASIC_PRICE_COST_KERNEL_RULE requirement).
 *
 * VERIFIED != PUBLISHED. VERIFIED means valid-per-review but still
 * internal; PUBLISHED (both axes) is the only publicly eligible state.
 */
export const PUBLIC_BASIC_PRICE_STATUS = 'PUBLISHED';
export const PUBLIC_BASIC_PRICE_VERIFICATION_STATUS =
  PriceVerificationStatus.PUBLISHED;

export type EligibilityReasonCode =
  | 'NOT_PUBLISHED'
  | 'NOT_VERIFICATION_TERMINAL'
  | 'RESOURCE_IDENTITY_MISSING'
  | 'UNIT_IDENTITY_MISSING'
  | 'REGION_IDENTITY_MISSING'
  | 'EFFECTIVE_DATE_MISSING'
  | 'SOURCE_IDENTITY_MISSING'
  | 'UNRESOLVED_COLLISION_PRESENT'
  | 'REJECTED'
  | 'INCOMPLETE_NEW_IMPORT_PROVENANCE'
  | 'ELIGIBLE';

export interface EligibilityResult {
  eligible: boolean;
  reasonCode: EligibilityReasonCode;
}

/**
 * Full evaluation input. Every field beyond status/verificationStatus is
 * optional because today's only caller (the public read API, below) never
 * had region/unit/collision/provenance evidence to check in the first
 * place — those checks only start to matter once a future caller (AHSP
 * resolution, Cost Kernel) has that fuller context. An unset optional
 * field is treated as "not a blocker" (fail-open on that one dimension),
 * never as an automatic pass on the whole record — status and
 * verificationStatus are always mandatory.
 */
export interface EligibilityCandidate {
  status: string;
  verificationStatus: PriceVerificationStatus | string;
  resourceId?: string | null;
  unit?: string | null;
  regionId?: string | null;
  effectiveDate?: Date | string | null;
  sourceOrigin?: string | null;
  freshnessStatus?: string | null;
  hasUnresolvedCollision?: boolean;
  rejected?: boolean;
  /**
   * Only meaningful for RM-02-imported prices (a BasicPrice reached via
   * BasicPriceImportRow -> PriceSubmission -> review -> publish). Omit or
   * pass `true` for legacy/non-RM02 prices — the check does not apply to
   * them (schema contract §10: "for RM-02-imported prices specifically").
   */
  importProvenanceComplete?: boolean;
}

@Injectable()
export class BasicPriceEligibilityPolicy {
  /**
   * The exact Prisma where-fragment every public/eligible-only query must
   * use. This is a narrow, behavior-preserving extraction of the
   * predicate basic-price.service.ts already enforced — it intentionally
   * does NOT add region/unit/effectiveDate/etc. filtering, because the
   * live public API and the one existing legacy BasicPrice row
   * (regionId IS NULL) both already rely on this exact narrow shape.
   * Widening it is a policy decision for a future, separately-authorized
   * task, not this refactor.
   */
  publicEligibilityWhere(): Pick<
    Prisma.BasicPriceWhereInput,
    'status' | 'verificationStatus'
  > {
    return {
      status: PUBLIC_BASIC_PRICE_STATUS,
      verificationStatus: PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
    };
  }

  /**
   * Full, reason-coded evaluation for future AHSP-resolution / Cost-Kernel
   * callers (not wired into any live call site by this task — see
   * AHSP_REUSE_PLAN / COST_KERNEL_REUSE_PLAN in 01-RM02B0-SCHEMA-CONTRACT.md
   * §10). Checks are evaluated in the exact priority order the schema
   * contract's reason-code list is written in, and returns the first
   * failing reason so a caller can surface a single, specific cause.
   */
  evaluate(candidate: EligibilityCandidate): EligibilityResult {
    if (candidate.status !== PUBLIC_BASIC_PRICE_STATUS) {
      return { eligible: false, reasonCode: 'NOT_PUBLISHED' };
    }
    if (
      candidate.verificationStatus !== PUBLIC_BASIC_PRICE_VERIFICATION_STATUS
    ) {
      return { eligible: false, reasonCode: 'NOT_VERIFICATION_TERMINAL' };
    }
    if (!candidate.resourceId) {
      return { eligible: false, reasonCode: 'RESOURCE_IDENTITY_MISSING' };
    }
    if (candidate.unit !== undefined && !candidate.unit) {
      return { eligible: false, reasonCode: 'UNIT_IDENTITY_MISSING' };
    }
    if (candidate.regionId !== undefined && !candidate.regionId) {
      return { eligible: false, reasonCode: 'REGION_IDENTITY_MISSING' };
    }
    if (!candidate.effectiveDate) {
      return { eligible: false, reasonCode: 'EFFECTIVE_DATE_MISSING' };
    }
    if (!candidate.sourceOrigin) {
      return { eligible: false, reasonCode: 'SOURCE_IDENTITY_MISSING' };
    }
    // freshnessStatus is evidence only. CURRENT / EXPIRING / EXPIRED never
    // determines public eligibility; validity and publication remain separate.
    if (candidate.hasUnresolvedCollision) {
      return { eligible: false, reasonCode: 'UNRESOLVED_COLLISION_PRESENT' };
    }
    if (candidate.rejected) {
      return { eligible: false, reasonCode: 'REJECTED' };
    }
    if (candidate.importProvenanceComplete === false) {
      return {
        eligible: false,
        reasonCode: 'INCOMPLETE_NEW_IMPORT_PROVENANCE',
      };
    }
    return { eligible: true, reasonCode: 'ELIGIBLE' };
  }
}

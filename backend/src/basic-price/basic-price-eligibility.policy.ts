import { Injectable } from '@nestjs/common';
import {
  BasicPriceAssetScope,
  Prisma,
  PriceVerificationStatus,
} from '@prisma/client';

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

export const BASIC_PRICE_ELIGIBILITY_POLICY_VERSION =
  'RM03C_PRIVATE_BASIC_PRICE_ELIGIBILITY_V1';

/**
 * RM-03C — which Basic Prices a workspace may actually USE.
 *
 * Owner law recognises two legitimate asset families, and they are NOT the
 * same thing:
 *
 *   SIMPROK_CATALOG    a curated national/general price. Reaching it still
 *                      requires the unchanged publication ladder:
 *                      status = 'PUBLISHED' AND verificationStatus = PUBLISHED.
 *   WORKSPACE_PRIVATE  a workspace's OWN price, imported because the catalog
 *                      has nothing suitable. Usable by its owner immediately.
 *                      It needs no national publication, no verifier, no
 *                      publisher, and no second human.
 *
 * Private use is therefore expressed as a SEPARATE, ADDITIVE branch, exactly
 * as RM-03B did for AHSP. A private price is never stamped PUBLISHED to make
 * it eligible — that would call a private asset "published", which the Owner
 * law forbids, and would make it indistinguishable from a curated one. The
 * database refuses that lie outright
 * (basic_prices_private_never_published_check).
 *
 * NO PRECEDENCE. Neither branch outranks the other. This builder only decides
 * WHICH rows are legally eligible; it never orders, ranks, filters or
 * tie-breaks between an eligible private price and an eligible catalog price
 * for the same resource. The existing selection logic stays scope-blind:
 * `resolveAhspResourcePrice` still returns NEEDS_REVIEW whenever more than one
 * compatible candidate survives, whatever each candidate's assetScope is —
 * SIMPROK menghitung, manusia memutuskan. Introducing a
 * private-beats-catalog (or catalog-beats-private) rule is an OPEN OWNER
 * DECISION and is deliberately NOT taken here.
 *
 * SECURITY — why the private branch uses strict equality and the catalog
 * branch does not: the catalog branch's `OR: [{workspaceId}, {workspaceId:
 * null}]` is correct for curated data, because a null-workspace catalog row is
 * genuinely national. Reusing that clause for the private branch would make
 * every null-workspace row eligible for every tenant at once — a
 * cross-workspace leak. The private branch is keyed on OWNERSHIP OF THE ROW:
 * `workspaceId` EXACTLY equal to the caller's trusted workspace, never null,
 * never an OR. The database makes the null case unrepresentable as well
 * (basic_prices_private_requires_workspace_check), so this is belt AND braces.
 */
export const BASIC_PRICE_ASSET_SCOPE = {
  SIMPROK_CATALOG: BasicPriceAssetScope.SIMPROK_CATALOG,
  WORKSPACE_PRIVATE: BasicPriceAssetScope.WORKSPACE_PRIVATE,
} as const;

/**
 * The catalog branch — semantically identical to the pre-RM-03C predicate
 * every workspace-scoped caller already built by hand
 * (`{...publicEligibilityWhere(), OR: [{workspaceId}, {workspaceId: null}]}`).
 * The text moved into a builder and now sits inside an OR, so this is NOT a
 * byte-identical copy; what is preserved is the MEANING, and the unit spec
 * asserts each condition individually rather than trusting the shape.
 *
 * `assetScope` is deliberately NOT asserted here. The catalog predicate must
 * remain exactly the publication predicate — adding an ownership condition to
 * it would make publication mean something it did not mean yesterday. It is
 * also unnecessary: a WORKSPACE_PRIVATE row can never satisfy
 * status = 'PUBLISHED' AND verificationStatus = PUBLISHED, because the
 * database forbids that combination on a private row.
 */
const catalogAssetBranch = (
  workspaceId: string,
): Prisma.BasicPriceWhereInput => ({
  status: PUBLIC_BASIC_PRICE_STATUS,
  verificationStatus: PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
  OR: [{ workspaceId }, { workspaceId: null }],
});

/**
 * The private branch — additive, and strictly scoped to one workspace.
 *
 * What genuinely disqualifies a private price is NOT "nobody nationally
 * published it" — that is the whole point of the asset family. It is a
 * terminal REJECTED verification state. Stated as an exclusion rather than an
 * allow-list on purpose: the private writer can only produce UNVERIFIED today,
 * so an allow-list of UNVERIFIED would silently un-elect a workspace's own
 * price the moment any future lifecycle touched that column.
 *
 * Everything else a private price needs in order to be technically usable
 * (region, effective date, validity window, unit compatibility) is asserted by
 * the CALLER, identically for both branches — there is no private shortcut
 * around the technical applicability rules.
 */
const privateAssetBranch = (
  workspaceId: string,
): Prisma.BasicPriceWhereInput => ({
  assetScope: BASIC_PRICE_ASSET_SCOPE.WORKSPACE_PRIVATE,
  // Never null. Never an OR. Never `workspaceId OR null`.
  workspaceId,
  verificationStatus: { not: PriceVerificationStatus.REJECTED },
});

/**
 * The single usable-Basic-Price predicate for one trusted workspace.
 *
 * Every workspace-scoped consumer builds its query from THIS function — the
 * Explorer list, the Explorer detail, by-resource lookup, Project AHSP
 * resource resolution, the AHSP re-verification read, and the Cost Kernel
 * persistence re-read. Building all of them from one function is the security
 * property, not a tidiness one: if the list could offer a price the resolver
 * would not accept (or worse, vice versa), the gap between them would be the
 * privilege escalation.
 *
 * Returns ONLY an `OR` key, so a caller may spread it alongside its own
 * scalar filters and its own `AND` clauses without either side clobbering the
 * other.
 */
export const buildUsableBasicPriceWhere = (
  workspaceId: string,
): Prisma.BasicPriceWhereInput => ({
  OR: [catalogAssetBranch(workspaceId), privateAssetBranch(workspaceId)],
});

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
   * RM-03C — the predicate every WORKSPACE-SCOPED consumer must use:
   * publicly eligible catalog prices, OR this workspace's own private
   * prices. Injected-service wrapper over `buildUsableBasicPriceWhere` so
   * existing DI call sites keep their shape.
   *
   * `publicEligibilityWhere()` above is deliberately left untouched and still
   * means exactly what it meant before: PUBLICATION. It remains the honest
   * answer to "is this row publicly eligible", which is a different question
   * from "may this workspace use this row".
   */
  usableWhere(workspaceId: string): Prisma.BasicPriceWhereInput {
    return buildUsableBasicPriceWhere(workspaceId);
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

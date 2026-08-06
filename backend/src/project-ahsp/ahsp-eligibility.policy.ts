import { AhspVersionStatus, Prisma } from '@prisma/client';

/**
 * RM-03B — which AHSP versions a workspace may bind to a BOQ item.
 *
 * Owner law recognises two legitimate origins, and they are NOT the same thing:
 *
 *   SIMPROK_CATALOG   a curated national/general AHSP. Reaching it requires
 *                     AhspVersionStatus.PUBLISHED, i.e. the internal
 *                     back-office publication ladder.
 *   WORKSPACE_PRIVATE a workspace's OWN AHSP, made because the catalog has
 *                     nothing suitable. It is usable by its owner immediately.
 *                     It needs no national publication, no verifier, no
 *                     publisher, and no second human.
 *
 * Private use is therefore expressed as a SEPARATE, ADDITIVE branch. A private
 * AHSP is never stamped PUBLISHED to make it eligible — that would call a
 * private asset "published", which the Owner law forbids, and would make it
 * indistinguishable from a curated one.
 *
 * SECURITY — why the private branch uses strict equality and the catalog
 * branch does not:
 *
 * `AHSP.ownershipType` defaults to USER_ASSET and is hardcoded to USER_ASSET by
 * AhspService.create for EVERY row it writes — including the `workspaceId: null`
 * "Official Repository" branch. ownershipType alone is therefore NOT a
 * private/catalog discriminator. Worse, it is user-mutable: the transfer route
 * can rewrite it, gated only by a reviewStatus that is self-grantable inside the
 * same workspace.
 *
 * So the private branch is keyed on OWNERSHIP OF THE ROW, not on a self-declared
 * label: BOTH the AHSP and the version must carry `workspaceId` EXACTLY equal to
 * the caller's trusted workspace. A NULL workspaceId can never satisfy it. Had
 * the private branch reused the catalog branch's `OR: [{workspaceId}, {workspaceId: null}]`
 * tenant clause, every null-workspace USER_ASSET row would have become eligible
 * for every tenant at once — a cross-workspace leak.
 */
export const AHSP_ELIGIBILITY_POLICY_VERSION =
  'RM03B_PRIVATE_ASSET_ELIGIBILITY_V1';

export const AHSP_ORIGIN = {
  SIMPROK_CATALOG: 'SIMPROK_CATALOG',
  WORKSPACE_PRIVATE: 'WORKSPACE_PRIVATE',
} as const;

export type AhspOrigin = (typeof AHSP_ORIGIN)[keyof typeof AHSP_ORIGIN];

/**
 * A private AHSP version is usable unless it has been retired. Stated as an
 * exclusion rather than an allow-list on purpose: the create path can only
 * produce DRAFT today, so an allow-list of "DRAFT" would silently un-elect a
 * user's own AHSP the moment any future lifecycle touched its status. What
 * genuinely disqualifies a private version is that it has been replaced
 * (SUPERSEDED) or retired (ARCHIVED) — not that nobody nationally published it.
 */
export const PRIVATE_UNUSABLE_VERSION_STATUSES: AhspVersionStatus[] = [
  AhspVersionStatus.SUPERSEDED,
  AhspVersionStatus.ARCHIVED,
];

/**
 * Completeness conditions shared by both origins. These are the Owner law's
 * "wajib lengkap ... dan compatible" expressed as data: a version with no
 * output unit or no resources cannot be priced at all, whoever owns it.
 */
const sharedCompleteness = (asOf: Date) => ({
  effectiveDate: { lte: asOf },
  outputUnit: { not: null },
  resources: { some: {} },
});

/**
 * The catalog branch — byte-for-byte the pre-RM-03B predicate. Public/catalog
 * behaviour must not change: same PUBLISHED requirement, same
 * `deletedAt: null`, same `OR: [{workspaceId}, {workspaceId: null}]` tenant
 * clause on both the AHSP and the version.
 */
const catalogBranch = (
  workspaceId: string,
): Prisma.AHSPVersionWhereInput => ({
  status: AhspVersionStatus.PUBLISHED,
  ahsp: {
    is: {
      deletedAt: null,
      OR: [{ workspaceId }, { workspaceId: null }],
    },
  },
  OR: [{ workspaceId }, { workspaceId: null }],
});

/**
 * The private branch — additive, and strictly scoped to one workspace.
 *
 * `archivedAt: null` is asserted here even though the catalog branch does not
 * assert it: the pre-existing predicate only ever checked `deletedAt`, and an
 * archived-but-not-deleted AHSP would otherwise become bindable through the new
 * branch. Tightening the catalog branch to match is deliberately NOT done here
 * — that would be a silent change to public behaviour.
 */
const privateBranch = (
  workspaceId: string,
): Prisma.AHSPVersionWhereInput => ({
  status: { notIn: PRIVATE_UNUSABLE_VERSION_STATUSES },
  // The version itself must belong to this workspace. Never null.
  workspaceId,
  ahsp: {
    is: {
      deletedAt: null,
      archivedAt: null,
      ownershipType: 'USER_ASSET',
      // The owning AHSP must belong to this workspace. Never null.
      workspaceId,
    },
  },
});

/**
 * The single eligibility predicate. `listEligibleVersions` and the
 * `selectForBoqItem` revalidation both build their query from THIS function, so
 * the list a user is offered and the set the server will actually accept can
 * never drift apart. Drift between those two is a privilege-escalation shape:
 * anything reachable by the picker must be exactly what the binding revalidates.
 */
export const buildEligibleAhspVersionWhere = (
  workspaceId: string,
  asOf: Date,
): Prisma.AHSPVersionWhereInput => ({
  ...sharedCompleteness(asOf),
  AND: [
    { OR: [{ expiredDate: null }, { expiredDate: { gte: asOf } }] },
    { OR: [catalogBranch(workspaceId), privateBranch(workspaceId)] },
  ],
});

/**
 * Which origin a row actually came from, for honest display. Derived from the
 * persisted row rather than from which query branch matched, so the label
 * cannot claim an origin the data does not support.
 *
 * PUBLISHED always reads as catalog: a nationally published version is a
 * catalog asset regardless of which workspace happens to own it.
 */
export const classifyAhspOrigin = (
  version: {
    status: AhspVersionStatus;
    ahsp: { workspaceId: string | null; ownershipType: string };
  },
  workspaceId: string,
): AhspOrigin =>
  version.status !== AhspVersionStatus.PUBLISHED &&
  version.ahsp.ownershipType === 'USER_ASSET' &&
  version.ahsp.workspaceId !== null &&
  version.ahsp.workspaceId === workspaceId
    ? AHSP_ORIGIN.WORKSPACE_PRIVATE
    : AHSP_ORIGIN.SIMPROK_CATALOG;

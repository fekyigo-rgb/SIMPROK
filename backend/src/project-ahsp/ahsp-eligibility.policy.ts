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
 *
 * `effectiveDate` is deliberately NOT one of these. It is a date condition, not
 * a completeness condition, and it now lives beside the `expiredDate` clause in
 * the builder where the other date lives — see the note there.
 */
const sharedCompleteness = () => ({
  outputUnit: { not: null },
  resources: { some: {} },
});

/**
 * The catalog branch — semantically the pre-RM-03B predicate. The text was
 * restructured (it now lives in a builder and sits inside an OR), so this is
 * NOT a byte-identical copy; what is preserved is the meaning, and the unit
 * spec asserts each condition individually rather than trusting the shape:
 * same PUBLISHED requirement, same `deletedAt: null`, same
 * `OR: [{workspaceId}, {workspaceId: null}]` tenant clause on both the AHSP
 * and the version.
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
 * The lawful-formula predicate. `listEligibleVersions`, `selectForBoqItem`,
 * and RAB lock all start from THIS function so completeness, dates, catalog
 * PUBLISHED, and private-unretired cannot drift. New-use currentness is a
 * separate projection (`pickCurrentApplicableAhspVersions` / a newer-sibling
 * check). Lock must NOT apply that projection, or a historical binding would
 * fail the moment a newer snapshot existed.
 */
export const buildEligibleAhspVersionWhere = (
  workspaceId: string,
  asOf: Date,
): Prisma.AHSPVersionWhereInput => ({
  ...sharedCompleteness(),
  AND: [
    // AN AHSP IS A FORMULA BORN OF A REGULATION, NOT A DATED PRICE.
    //
    // A NULL effectiveDate means the source never stated when the analysis began
    // to apply — it does NOT mean the analysis has stopped applying. Treating the
    // absence of a date as "not in force" made every document-imported AHSP
    // permanently invisible to selection, which is not a law this repository ever
    // stated: it disqualified on unknown, not on evidence.
    //
    // What still disqualifies is a date that IS proven and has not arrived yet, so
    // a version whose effectiveDate lies in the future stays out. This mirrors the
    // expiredDate clause immediately below, where a NULL has always meant "no
    // proven end" rather than "expired". Unknown is unknown on both ends.
    { OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOf } }] },
    { OR: [{ expiredDate: null }, { expiredDate: { gte: asOf } }] },
    { OR: [catalogBranch(workspaceId), privateBranch(workspaceId)] },
  ],
});

/**
 * NEW-USE CURRENTNESS — one applicable snapshot per parent AHSP.
 *
 * `buildEligibleAhspVersionWhere` answers "is this row still a lawful formula"
 * (complete, in date, catalog-published or private-unretired). RAB lock and
 * already-bound occurrences must keep asking THAT question, or a line priced
 * against an older snapshot would fail closed the moment a newer sibling
 * existed.
 *
 * New selection is a different question: among those already-lawful rows,
 * one parent may offer only one snapshot. `versionNumber` is NOT regulation
 * authority and is NOT the date window — `createVersion` assigns it as the
 * append ordinal of snapshots on that parent (`last + 1`). After the WHERE
 * above has applied source dates and lifecycle, the highest ordinal is the
 * latest recorded revision of that parent. An expired higher number never
 * reaches this function because WHERE already excluded it.
 */
export const pickCurrentApplicableAhspVersions = <
  T extends { id: string; versionNumber: number; ahsp: { id: string } },
>(
  versions: T[],
): T[] => {
  const currentByParent = new Map<string, T>();
  for (const version of versions) {
    const current = currentByParent.get(version.ahsp.id);
    if (!current || version.versionNumber > current.versionNumber) {
      currentByParent.set(version.ahsp.id, version);
    }
  }
  const currentIds = new Set(
    [...currentByParent.values()].map((version) => version.id),
  );
  return versions.filter((version) => currentIds.has(version.id));
};

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

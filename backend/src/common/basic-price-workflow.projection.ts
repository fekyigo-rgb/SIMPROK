import { Prisma } from '@prisma/client';
import { toDecimalString2 } from './money';
import {
  reverificationState,
  type ReverificationState,
} from '../basic-price/basic-price-reverification.policy';

/**
 * RM-02D2A2 — the single canonical projection layer for the Basic Price
 * review & publication user journey. Controllers/services MUST return these
 * explicit projections, never a raw Prisma entity: a raw entity leaks
 * internal columns, exposes a UUID where a human needs a human-readable
 * identity, and (for money) does not lock the exact decimal-string contract.
 *
 * Every function here is pure and structurally typed so it is unit-testable
 * with plain objects and shared identically across the review queue, review
 * detail, publication queue, and reviewer-candidate contracts.
 */

type DateLike = Date | string;

const toIso = (value: DateLike): string =>
  value instanceof Date ? value.toISOString() : value;

const toIsoOrNull = (value: DateLike | null | undefined): string | null =>
  value === null || value === undefined ? null : toIso(value);

// ── Shared human-readable identities ────────────────────────────────────────

/** A resource a human can recognize — never a bare UUID. */
export interface ResourceIdentity {
  id: string;
  code: string | null;
  name: string;
  type: string;
}

/** A region a human can recognize — always "code — name" on screen. */
export interface RegionIdentity {
  id: string;
  code: string;
  name: string;
}

/** A person a human can recognize — full name + email, never a raw UUID label. */
export interface ReviewerIdentity {
  userId: string;
  fullName: string;
  email: string;
}

export function mapResourceIdentity(resource: {
  id: string;
  code: string | null;
  name: string;
  type: string;
}): ResourceIdentity {
  return {
    id: resource.id,
    code: resource.code ?? null,
    name: resource.name,
    type: resource.type,
  };
}

export function mapRegionIdentity(
  region: { id: string; code: string; name: string } | null | undefined,
): RegionIdentity | null {
  return region
    ? { id: region.id, code: region.code, name: region.name }
    : null;
}

export function mapReviewerIdentity(
  reviewer: { id: string; fullName: string; email: string } | null | undefined,
): ReviewerIdentity | null {
  return reviewer
    ? {
        userId: reviewer.id,
        fullName: reviewer.fullName,
        email: reviewer.email,
      }
    : null;
}

// ── Structural input shapes (subset of the Prisma-included rows) ─────────────

interface AssignedUserSource {
  id: string;
  fullName: string;
  membership: { account: { email: string } };
}

interface RevisionSource {
  id: string;
  value: Prisma.Decimal | string;
  effectiveDate: DateLike | null;
}

interface SubmissionSource {
  status: string;
  sourceType: string;
  sourceOrigin: string;
  currentRevisionId: string | null;
  resource: { id: string; code: string | null; name: string; type: string };
  region: { id: string; code: string; name: string } | null;
  revisions: RevisionSource[];
}

interface ReviewDecisionSource {
  id: string;
  action: string;
  note: string | null;
  decidedAt: DateLike;
  decidedBy: AssignedUserSource | null;
}

export interface ReviewRowSource {
  id: string;
  priceSubmissionId: string;
  slaState: string;
  openedAt: DateLike;
  escalatedAt: DateLike | null;
  expiredAt: DateLike | null;
  resolvedAt: DateLike | null;
  submission: SubmissionSource;
  assignedTo: AssignedUserSource | null;
  decisions?: ReviewDecisionSource[];
}

// ── Review queue / detail projections ────────────────────────────────────────

export interface ReviewQueueItem {
  reviewId: string;
  priceSubmissionId: string;
  slaState: string;
  openedAt: string;
  escalatedAt: string | null;
  expiredAt: string | null;
  resolvedAt: string | null;
  submissionStatus: string;
  resource: ResourceIdentity;
  region: RegionIdentity | null;
  /** Exact decimal string, two digits, or null when no current revision. */
  currentPrice: string | null;
  effectiveDate: string | null;
  assignedReviewer: ReviewerIdentity | null;
}

export interface ReviewDecisionProjection {
  id: string;
  action: string;
  note: string | null;
  decidedAt: string;
  decidedBy: ReviewerIdentity | null;
}

export interface ReviewDetail extends ReviewQueueItem {
  sourceType: string;
  sourceOrigin: string;
  decisions: ReviewDecisionProjection[];
}

const currentRevisionOf = (
  submission: SubmissionSource,
): RevisionSource | null =>
  submission.revisions.find(
    (revision) => revision.id === submission.currentRevisionId,
  ) ?? null;

const reviewerOf = (
  source: AssignedUserSource | null,
): ReviewerIdentity | null =>
  source
    ? mapReviewerIdentity({
        id: source.id,
        fullName: source.fullName,
        email: source.membership.account.email,
      })
    : null;

export function mapReviewQueueItem(review: ReviewRowSource): ReviewQueueItem {
  const revision = currentRevisionOf(review.submission);
  return {
    reviewId: review.id,
    priceSubmissionId: review.priceSubmissionId,
    slaState: review.slaState,
    openedAt: toIso(review.openedAt),
    escalatedAt: toIsoOrNull(review.escalatedAt),
    expiredAt: toIsoOrNull(review.expiredAt),
    resolvedAt: toIsoOrNull(review.resolvedAt),
    submissionStatus: review.submission.status,
    resource: mapResourceIdentity(review.submission.resource),
    region: mapRegionIdentity(review.submission.region),
    currentPrice: revision ? toDecimalString2(revision.value) : null,
    effectiveDate: revision ? toIsoOrNull(revision.effectiveDate) : null,
    assignedReviewer: reviewerOf(review.assignedTo),
  };
}

export function mapReviewDecision(
  decision: ReviewDecisionSource,
): ReviewDecisionProjection {
  return {
    id: decision.id,
    action: decision.action,
    note: decision.note ?? null,
    decidedAt: toIso(decision.decidedAt),
    decidedBy: reviewerOf(decision.decidedBy),
  };
}

export function mapReviewDetail(review: ReviewRowSource): ReviewDetail {
  return {
    ...mapReviewQueueItem(review),
    sourceType: review.submission.sourceType,
    sourceOrigin: review.submission.sourceOrigin,
    decisions: (review.decisions ?? []).map(mapReviewDecision),
  };
}

// ── Publication queue projection ─────────────────────────────────────────────

export interface PublicationQueueItem {
  basicPriceId: string;
  resource: ResourceIdentity;
  region: RegionIdentity | null;
  /** Exact decimal string, two digits. */
  price: string;
  effectiveDate: string;
  status: string;
  verificationStatus: string;
  createdAt: string;
}

export interface BasicPriceRowSource {
  id: string;
  value: Prisma.Decimal | string;
  effectiveDate: DateLike;
  status: string;
  verificationStatus: string;
  createdAt: DateLike;
  resource: { id: string; code: string | null; name: string; type: string };
  region: { id: string; code: string; name: string } | null;
}

export function mapPublicationQueueItem(
  row: BasicPriceRowSource,
): PublicationQueueItem {
  return {
    basicPriceId: row.id,
    resource: mapResourceIdentity(row.resource),
    region: mapRegionIdentity(row.region),
    price: toDecimalString2(row.value),
    effectiveDate: toIso(row.effectiveDate),
    status: row.status,
    verificationStatus: row.verificationStatus,
    createdAt: toIso(row.createdAt),
  };
}

// ── Workspace-private Basic Price projection (RM-03C) ───────────────────────

export interface PrivateBasicPriceItem {
  basicPriceId: string;
  resource: ResourceIdentity;
  region: RegionIdentity | null;
  /** Exact decimal string, two digits. */
  price: string;
  effectiveDate: string;
  /** Always WORKSPACE_PRIVATE here — stated, never assumed by the reader. */
  assetScope: 'WORKSPACE_PRIVATE';
  /**
   * Where the PRICE came from, which is a different question from who owns
   * the asset. A private price may truthfully be GOVERNMENT / SUPPLIER /
   * STORE / DISTRIBUTOR / FIELD_REPORT — there is no "private" source.
   */
  sourceOrigin: string;
  /** Publication axes, echoed so a caller can see they were NOT touched. */
  status: string;
  verificationStatus: string;
  /** The import row this price was materialized from — its only evidence. */
  sourceImportRowId: string;
  /**
   * RM-03D1 — TEMPORAL PROVENANCE, surfaced rather than left in the database.
   *
   * `effectiveDate` above is a single day, and a caller cannot tell from it
   * alone whether the source printed that day or SIMPROK derived it. These four
   * answer that: what the source's own period wording was, how coarse it is,
   * whether the date is stated or derived, and by which named rule. A null
   * provenance means UNKNOWN — never "the source stated this".
   */
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

export interface PrivateBasicPriceRowSource {
  id: string;
  value: Prisma.Decimal | string;
  effectiveDate: DateLike;
  status: string;
  verificationStatus: string;
  sourceOrigin: string;
  sourceImportRowId: string | null;
  sourcePeriodLabel?: string | null;
  sourcePeriodGranularity?: string | null;
  effectiveDateProvenance?: string | null;
  effectiveDateDerivationRule?: string | null;
  resource: { id: string; code: string | null; name: string; type: string };
  region: { id: string; code: string; name: string } | null;
}

export function mapPrivateBasicPriceItem(
  row: PrivateBasicPriceRowSource,
): PrivateBasicPriceItem {
  return {
    basicPriceId: row.id,
    resource: mapResourceIdentity(row.resource),
    region: mapRegionIdentity(row.region),
    price: toDecimalString2(row.value),
    effectiveDate: toIso(row.effectiveDate),
    assetScope: 'WORKSPACE_PRIVATE',
    sourceOrigin: row.sourceOrigin,
    status: row.status,
    verificationStatus: row.verificationStatus,
    // Non-null by construction: the writer always sets it and the database
    // refuses a private row without it. The `??` is a type narrowing, not a
    // fallback that could ever fabricate an empty provenance reference.
    sourceImportRowId: row.sourceImportRowId ?? '',
    // `?? null` is a narrowing for callers that do not select these columns —
    // never a fabricated claim. Absent reads as UNKNOWN, which is the honest
    // answer when the projection was not given the facts.
    sourcePeriodLabel: row.sourcePeriodLabel ?? null,
    sourcePeriodGranularity: row.sourcePeriodGranularity ?? null,
    effectiveDateProvenance: row.effectiveDateProvenance ?? null,
    effectiveDateDerivationRule: row.effectiveDateDerivationRule ?? null,
  };
}

// ── Basic Price Explorer projection (RM02D2A2 remediation) ──────────────────
//
// The Explorer is the primary, public-facing Basic Price door (Owner Lock:
// PRIMARY_BASIC_PRICE_DOOR=EXPLORER). Its contract never returns a raw Prisma
// BasicPrice row — every field is an explicit, human-readable projection, and
// money is always the exact two-digit decimal string produced by
// toDecimalString2 (never Number()/parseFloat()/float math).

/** A resource identity that also carries its base unit, for the Explorer list. */
export interface ExplorerResourceIdentity extends ResourceIdentity {
  baseUnit: string;
}

export function mapExplorerResourceIdentity(resource: {
  id: string;
  code: string | null;
  name: string;
  type: string;
  baseUnit: string;
}): ExplorerResourceIdentity {
  return { ...mapResourceIdentity(resource), baseUnit: resource.baseUnit };
}

/** WORKSPACE = belongs to the caller's own workspace; GLOBAL = workspaceId is null. */
export type BasicPriceWorkspaceScope = 'WORKSPACE' | 'GLOBAL';

/**
 * RM-03C — which asset family a row belongs to. This is a DIFFERENT question
 * from `workspaceScope`, which only says whose tenancy column the row carries:
 * a curated catalog price can legitimately be workspace-scoped too. Only
 * `assetScope` answers "is this MY OWN price, or SIMPROK's catalog price".
 */
export type BasicPriceAssetScopeLabel = 'WORKSPACE_PRIVATE' | 'SIMPROK_CATALOG';

export interface BasicPriceExplorerItem {
  basicPriceId: string;
  resource: ExplorerResourceIdentity;
  region: RegionIdentity | null;
  /** Exact decimal string, two digits. */
  price: string;
  effectiveDate: string;
  validUntil: string | null;
  sourceType: string;
  sourceOrigin: string;
  /**
   * Human-readable source name derived ONLY from real provenance (the import
   * batch's vendor/organization name, via
   * BasicPrice.sourceSubmission -> PriceSubmission.importRow ->
   * BasicPriceImportRow.batch). Never fabricated: null when that provenance
   * chain is absent (e.g. no sourceSubmission), so the UI can show an honest
   * "Sumber tidak tersedia" instead of a placeholder presented as fact.
   */
  sourceName: string | null;
  freshnessStatus: string;
  /**
   * SOFT RE-VERIFICATION — the date SIMPROK recommends this price be checked
   * again, or null when it recommends nothing (a live integration reports its
   * own freshness; a source with no stated period has nothing to anchor to).
   *
   * IT IS NOT `validUntil`, and the two must never be rendered with the same
   * words. `validUntil` is a hard boundary the Cost Kernel and AHSP resolution
   * actually enforce; this is advice. A price past this date stays fully
   * usable and stays in every candidate set.
   */
  reviewDate: string | null;
  /**
   * Derived here, never stored: `DUE` once the recommended date has passed,
   * `NOT_RECOMMENDED` when no date was ever recommended. Nothing filters on it.
   */
  reverification: ReverificationState;
  workspaceScope: BasicPriceWorkspaceScope;
  /**
   * RM-03C. Read straight off the persisted column — never inferred from which
   * eligibility branch happened to match, and never inferred from workspaceId,
   * status or verificationStatus. A label must never claim an ownership the
   * data does not carry.
   */
  assetScope: BasicPriceAssetScopeLabel;
}

/** An import batch's human-facing source identity, wherever it is reached from. */
interface ImportBatchSourceNames {
  sourceOrganizationName: string | null;
  sourceVendorName: string | null;
}

/** Structural subset of the Prisma-included BasicPrice row for the Explorer. */
export interface ExplorerRowSource {
  id: string;
  workspaceId: string | null;
  assetScope: string;
  value: Prisma.Decimal | string;
  effectiveDate: DateLike;
  validUntil: DateLike | null;
  /** Optional so every existing caller and fixture keeps compiling unchanged. */
  reviewDate?: DateLike | null;
  sourceType: string;
  sourceOrigin: string;
  freshnessStatus: string;
  resource: {
    id: string;
    code: string | null;
    name: string;
    type: string;
    baseUnit: string;
  };
  region: { id: string; code: string; name: string } | null;
  sourceSubmission?: {
    importRow?: {
      batch?: ImportBatchSourceNames | null;
    } | null;
  } | null;
  /**
   * RM-03C: a WORKSPACE_PRIVATE row's direct link to the SAME import batch.
   * One link shorter than the catalog chain because there is no
   * PriceSubmission in between — not a second provenance subsystem.
   */
  sourceImportRow?: {
    batch?: ImportBatchSourceNames | null;
  } | null;
}

/**
 * Derives a human-readable source name ONLY from a real, traceable provenance
 * chain (import batch vendor/organization name). Returns null — never a
 * fabricated placeholder — when no such chain exists for this row.
 *
 * Both chains end at the same BasicPriceImportBatch columns, so a private
 * price shows its supplier/organization exactly as honestly as a catalog price
 * does. The two are checked in sequence rather than merged: the database
 * guarantees a row can only ever have one of them
 * (basic_prices_import_row_link_private_only_check +
 * basic_prices_private_not_submission_born_check), so this can never silently
 * prefer one real source over another.
 */
export function deriveExplorerSourceName(
  row: ExplorerRowSource,
): string | null {
  const batch =
    row.sourceSubmission?.importRow?.batch ?? row.sourceImportRow?.batch;
  if (!batch) return null;
  // A blank/whitespace-only stored name is not a real human-facing source
  // name either — treat it the same as absent rather than rendering "".
  const vendorName = batch.sourceVendorName?.trim();
  if (vendorName) return vendorName;
  const organizationName = batch.sourceOrganizationName?.trim();
  if (organizationName) return organizationName;
  return null;
}

export function mapExplorerItem(
  row: ExplorerRowSource,
  currentWorkspaceId: string,
): BasicPriceExplorerItem {
  return {
    basicPriceId: row.id,
    resource: mapExplorerResourceIdentity(row.resource),
    region: mapRegionIdentity(row.region),
    price: toDecimalString2(row.value),
    effectiveDate: toIso(row.effectiveDate),
    validUntil: toIsoOrNull(row.validUntil),
    sourceType: row.sourceType,
    sourceOrigin: row.sourceOrigin,
    sourceName: deriveExplorerSourceName(row),
    freshnessStatus: row.freshnessStatus,
    reviewDate: toIsoOrNull(row.reviewDate),
    reverification: reverificationState(
      row.reviewDate ? new Date(row.reviewDate) : null,
      new Date(),
    ),
    // The eligibility query only ever returns rows where workspaceId is the
    // caller's own workspace or null; this equality check is the honest
    // expression of that contract rather than a bare null check, so a future
    // caller that forgets the eligibility/tenant filter fails safe to GLOBAL
    // instead of mislabeling a foreign workspace's row as the caller's own.
    workspaceScope:
      row.workspaceId === currentWorkspaceId ? 'WORKSPACE' : 'GLOBAL',
    // Fail-safe direction: anything that is not exactly the private enum value
    // reads as SIMPROK_CATALOG. An unknown/absent value must never be
    // presented to a human as "your own private price".
    assetScope:
      row.assetScope === 'WORKSPACE_PRIVATE'
        ? 'WORKSPACE_PRIVATE'
        : 'SIMPROK_CATALOG',
  };
}

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
  /**
   * BP-EVIDENCE-MIG-04 — birth audit of a Detail-born observation/correction.
   * Explorer selects at most ONE row (oldest), and only so a human-readable
   * source identity can survive when this price has no import-row pointer.
   * The JSON itself never reaches the browser.
   */
  provenanceCorrections?: Array<{ after?: unknown }> | null;
}

function sourceNameFromBatch(
  batch: ImportBatchSourceNames | null | undefined,
): string | null {
  if (!batch) return null;
  const vendorName = batch.sourceVendorName?.trim();
  if (vendorName) return vendorName;
  const organizationName = batch.sourceOrganizationName?.trim();
  if (organizationName) return organizationName;
  return null;
}

/**
 * Human-readable source identity stored on an observation/correction audit.
 * Never an import-row id, never a storage path. Null when absent or blank.
 */
export function sourceIdentityNameFromAudit(after: unknown): string | null {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const raw = (after as { sourceIdentityName?: unknown }).sourceIdentityName;
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name.length > 0 ? name : null;
}

/**
 * Derives a human-readable source name from real provenance, never invented.
 *
 * Import-batch vendor/organization names win when THIS row has a chain.
 * A Detail-born observation has no import-row pointer — by law it must not
 * reuse the predecessor's file as proof of new money — so its identity name
 * is recovered from the birth audit instead. Batch names are never read off
 * a predecessor here: that would present May's quotation as proof of August.
 */
export function deriveExplorerSourceName(
  row: Pick<
    ExplorerRowSource,
    'sourceSubmission' | 'sourceImportRow' | 'provenanceCorrections'
  >,
): string | null {
  const fromBatch = sourceNameFromBatch(
    row.sourceSubmission?.importRow?.batch ?? row.sourceImportRow?.batch,
  );
  if (fromBatch) return fromBatch;
  return sourceIdentityNameFromAudit(row.provenanceCorrections?.[0]?.after);
}

/**
 * BP-UX-FINAL-01D GAP-D — ONE TEMPORAL CONTEXT PER SCREEN, NOT TWO.
 *
 * `asOf` used to be a `new Date()` written inline three lines below. That was
 * invisible while the Explorer only ever projected the present, and it became a
 * defect the moment "Berlaku pada tanggal" started answering applicability at a
 * chosen date D: the same row would then be selected for D and have its
 * FRESHNESS judged at wall-clock now. A person looking at 2024 would be shown a
 * 2024 price wearing a 2026 verdict, and nothing on the screen would say the
 * two sentences were about different days.
 *
 * So the instant is a PARAMETER, resolved once at the request boundary and
 * handed to applicability, currentness and this projection alike — the same
 * discipline `basicPriceCurrentnessWhere` and `basicPriceApplicabilityAnd`
 * already require of their callers.
 *
 * IT DEFAULTS TO THE PRESENT, and that default is the law rather than a
 * convenience: "no explicit asOf" MEANS the present, so a caller that states
 * nothing gets exactly what it would have got before. The two production
 * callers both pass explicitly regardless, so the default is a safety net for
 * fixtures rather than a path any route takes.
 */
export function mapExplorerItem(
  row: ExplorerRowSource,
  currentWorkspaceId: string,
  asOf: Date = new Date(),
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
    // Judged at the SAME instant the row was selected for. A price offered
    // because it applied on D is told about as it stood on D.
    reverification: reverificationState(
      row.reviewDate ? new Date(row.reviewDate) : null,
      asOf,
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

// ── BP-UX-FINAL-01D — the DETAIL + CORRECTION-LINEAGE read contract ─────────

/**
 * ONE PRICE, ITS EVIDENCE, AND ITS CORRECTIONS — never a raw Prisma entity.
 *
 * `GET /basic-prices/:id` deliberately still returns its raw row: eight
 * end-to-end specs read `verificationStatus`, `status` and `supersedesBasicPriceId`
 * straight off that response, and breaking a proven contract to tidy a shape is
 * not a repair. So the browser-facing detail is a SEPARATE bounded read, and
 * this is its contract.
 *
 * IT REUSES `BasicPriceExplorerItem` FOR THE PRICE ITSELF, ON PURPOSE. The
 * Detail panel and the Explorer row must never disagree about what a price is
 * called, what it costs, where it comes from or how fresh it is — and the only
 * way to guarantee that is for both to be the SAME projection function. Detail
 * adds depth around it; it does not restate it differently.
 */

/**
 * ONE CORRECTION IN A LINEAGE. NOT one price observation.
 *
 * The field is `corrections` and not `history` throughout, because the only
 * fact behind it is `BasicPrice.supersedesBasicPriceId` — an explicit human
 * claim that a published price REPLACED an erroneous one. A later, equally
 * valid observation of the same resource carries no such pointer and is not
 * here (`PublishBasicPriceDto`: "an ordinary publish states a NEW fact and
 * leaves every prior price standing"). A name that promised "price history"
 * over this data would be promising a completeness the column cannot give.
 *
 * NO `basicPriceId`. GAP-C. A predecessor's raw UUID is an internal
 * identifier, and rendering a dated amount in a list needs no identifier at
 * all — the browser keys these rows by position. The anchor's own id is
 * already known to the caller (it is the route parameter); its PREDECESSORS'
 * ids were never the browser's to hold, and nothing on any screen offers a
 * lawful action that would need one.
 */
export interface BasicPriceCorrectionEntry {
  /** Exact decimal string, two digits — never a float, at any depth. */
  price: string;
  effectiveDate: string;
  /**
   * CURRENT when nothing in the lawful set replaced this row; SUPERSEDED when
   * an exact `supersedesBasicPriceId` pointer names it. Never inferred from
   * age, value or date order.
   */
  state: 'CURRENT' | 'SUPERSEDED';
}

/**
 * THE CORRECTION LINEAGE, AND WHETHER IT IS ALL OF IT.
 *
 * `truncated` is the whole reason this is an object rather than a bare array.
 * The read that produces it is BOUNDED — deliberately, because an unbounded
 * backwards walk is a runaway traversal — so it must be able to say when it
 * stopped short. `false` means the lineage below reaches its own oldest member;
 * `true` means an older correction exists that this answer does not contain,
 * and the screen says "Riwayat Koreksi Terbaru" instead of "Riwayat Koreksi".
 *
 * Neither value is ever a claim about OBSERVATION history. Even an untruncated
 * lineage says only "these are the corrections", never "these are all the
 * prices this resource has ever had".
 */
export interface BasicPriceCorrectionHistory {
  /** Newest first, including this price itself. */
  entries: BasicPriceCorrectionEntry[];
  truncated: boolean;
}

/**
 * What SIMPROK can actually PROVE about where this price came from.
 *
 * TWO SEPARATE FACTS, BECAUSE THEY ARE TWO SEPARATE CLAIMS. Conflating them was
 * GAP-B, and the conflation ran in the direction that overclaims:
 *
 *   importBatchLinked     A traceable import-batch chain exists. This proves
 *                         the price came from a recorded arrival — a RELATION,
 *                         and nothing whatsoever about a file.
 *   originalFileRetained  The batch's ORIGINAL BYTES are retained
 *                         (`BasicPriceImportBatch.sourceStorageRef`, USI-01R2
 *                         §5: "WHERE THIS BATCH'S ORIGINAL BYTES ARE
 *                         RETAINED"). Null for every batch imported before
 *                         bytes were kept — which is why linkage could never
 *                         have implied it.
 *
 * The screen may say "the original upload is stored" ONLY on the second. On the
 * first alone it says only that the price is linked to a recorded import batch.
 *
 * NO IDENTIFIERS, AND NO PATHS. Not the batch id, not the submission id, not
 * the import-row id, not an actor — and emphatically not `sourceStorageRef`
 * itself, which is an internal storage location. A person reading a price needs
 * to know whether the evidence is traceable and whether the bytes survive; the
 * trail and the location belong to audit, not to a browser.
 */
/**
 * BP-EVIDENCE-MIG-04 — documentary vs field/user-reported, using existing
 * vocabulary rather than a new evidence taxonomy.
 *
 * SOURCE_DOCUMENT  this observation has (or a correction lawfully reuses)
 *                  an import-batch chain. The bytes may or may not still
 *                  be retained — that is `originalFileRetained`.
 * FIELD_REPORTED   an explicit field/user-report marker is present:
 *                  MARKET_SURVEY, FIELD_REPORT / COMMUNITY_REPORT, or a
 *                  writer evidenceClass of FIELD_REPORTED. Absence of a
 *                  documentary chain is not itself a field report.
 * null             unknown / legacy / unproven. Never fabricated as
 *                  FIELD_REPORTED, SOURCE_DOCUMENT, or VERIFIED.
 */
export type ObservationEvidenceBasis = 'SOURCE_DOCUMENT' | 'FIELD_REPORTED';

export interface BasicPriceEvidenceFacts {
  importBatchLinked: boolean;
  originalFileRetained: boolean;
  /** RM-03D1 — the source's own period wording, verbatim (e.g. "TA 2024"). */
  sourcePeriodLabel: string | null;
  /** Whether `effectiveDate` was STATED by the source or DERIVED by SIMPROK. */
  effectiveDateProvenance: string | null;
  /** The named rule that produced a DERIVED effectiveDate, so it is re-derivable. */
  effectiveDateDerivationRule: string | null;
  /**
   * Human-readable %KDN origin, never an internal id. Null when KDN is
   * unstated, or when this observation has no lawful public source sentence.
   */
  kdnSourceSummary: string | null;
  observationBasis: ObservationEvidenceBasis | null;
}

/**
 * %KDN — THE DOMESTIC-CONTENT FACT OF THE RESOURCE THIS PRICE IS FOR.
 *
 * IT IS NOT TKDN, AND THE TWO MAY NEVER BE COLLAPSED (Owner Lock):
 *
 *   %KDN   an item / resource / Basic Price level FACT about domestic content.
 *          This is that fact, and the only thing this interface carries.
 *   TKDN   a CALCULATED aggregate at RAB / Project level. It is not computed
 *          here, not stored here, and no field on this contract feeds it.
 *
 * WHERE THE VALUE COMES FROM. `ResourceCatalog.tkdnValue` — a
 * `Decimal(5,2)` that has existed since the 002 baseline migration. Its NAME is
 * a legacy collision with the aggregate above; its LEVEL is the resource, which
 * is exactly where a %KDN fact belongs. The column is deliberately left named
 * as it is: renaming a persisted column to tidy a label is a migration, and
 * this contract is not authority for one.
 *
 * NULL IS NOT ZERO, AND THAT IS THE WHOLE POINT. `0.00` is a substantive claim
 * — "this resource has no domestic content" — while `null` means nobody has
 * stated anything. Rendering the second as the first would manufacture a
 * compliance fact out of silence, so the projection passes `null` through
 * untouched and the screen says "Belum tersedia".
 *
 * NO COMPONENT BREAKDOWN IS OFFERED, because none exists. A census of the
 * schema finds no material / equipment / labour domestic-content columns
 * anywhere, so there is nothing lawful to expand into — and deriving components
 * backwards from a total would be inventing the very evidence a reader would
 * trust. If component facts are ever persisted, they belong here beside this
 * field, proven the same way.
 */
export interface BasicPriceDomesticContent {
  /**
   * Exact decimal string, two digits (e.g. `"72.50"`), or `null` when no
   * domestic-content fact has been stated. Never a float, never `0` for absent.
   */
  kdnPercent: string | null;
}

export interface BasicPriceDetail {
  price: BasicPriceExplorerItem;
  evidence: BasicPriceEvidenceFacts;
  corrections: BasicPriceCorrectionHistory;
  domesticContent: BasicPriceDomesticContent;
}

/** The one evidence column read off a batch beyond its two source names. */
interface ImportBatchEvidenceFacts {
  sourceStorageRef?: string | null;
}

/** Structural subset carrying the extra evidence columns Detail reads. */
export interface DetailRowSource extends ExplorerRowSource {
  sourcePeriodLabel?: string | null;
  effectiveDateProvenance?: string | null;
  effectiveDateDerivationRule?: string | null;
  /**
   * BP-KDN-01 — the observation's own %KDN. Optional so every existing
   * caller and fixture keeps compiling: a row that never selected it
   * reports `null`, which is the honest answer rather than a fabricated zero.
   */
  kdnPercent?: Prisma.Decimal | string | null;
  kdnEstablishment?: string | null;
  sourceSubmission?: {
    importRow?: {
      batch?: (ImportBatchSourceNames & ImportBatchEvidenceFacts) | null;
    } | null;
  } | null;
  sourceImportRow?: {
    sourceKdnHeaderText?: string | null;
    batch?:
      | (ImportBatchSourceNames &
          ImportBatchEvidenceFacts & { sourceFileName?: string | null })
      | null;
  } | null;
  /**
   * Correction predecessor only. Used to reuse original import evidence
   * truthfully without duplicating the unique import-row pointer. New
   * observations have no supersession pointer and never inherit a file.
   */
  supersedes?: {
    sourceSubmission?: {
      importRow?: {
        batch?: (ImportBatchSourceNames & ImportBatchEvidenceFacts) | null;
      } | null;
    } | null;
    sourceImportRow?: {
      batch?: (ImportBatchSourceNames & ImportBatchEvidenceFacts) | null;
    } | null;
  } | null;
}

/** Structural subset of one lineage row, as selected for the timeline read. */
export interface HistoryRowSource {
  id: string;
  value: Prisma.Decimal | string;
  effectiveDate: DateLike;
  supersedesBasicPriceId: string | null;
}

function ownEvidenceBatch(
  row: DetailRowSource,
): (ImportBatchSourceNames & ImportBatchEvidenceFacts) | null | undefined {
  return row.sourceSubmission?.importRow?.batch ?? row.sourceImportRow?.batch;
}

function inheritedCorrectionEvidenceBatch(
  row: DetailRowSource,
): (ImportBatchSourceNames & ImportBatchEvidenceFacts) | null | undefined {
  if (ownEvidenceBatch(row)) return null;
  const predecessor = row.supersedes;
  if (!predecessor) return null;
  return (
    predecessor.sourceSubmission?.importRow?.batch ??
    predecessor.sourceImportRow?.batch
  );
}

function evidenceClassFromAudit(after: unknown): string | null {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const raw = (after as { evidenceClass?: unknown }).evidenceClass;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function hasExplicitFieldReportMarker(row: DetailRowSource): boolean {
  if (row.sourceType === 'MARKET_SURVEY') return true;
  if (
    row.sourceOrigin === 'FIELD_REPORT' ||
    row.sourceOrigin === 'COMMUNITY_REPORT'
  ) {
    return true;
  }
  return (
    evidenceClassFromAudit(row.provenanceCorrections?.[0]?.after) ===
    'FIELD_REPORTED'
  );
}

function observationBasisOf(
  row: DetailRowSource,
  importBatchLinked: boolean,
): ObservationEvidenceBasis | null {
  if (importBatchLinked) return 'SOURCE_DOCUMENT';
  if (hasExplicitFieldReportMarker(row)) return 'FIELD_REPORTED';
  return null;
}

export function mapBasicPriceEvidence(
  row: DetailRowSource,
): BasicPriceEvidenceFacts {
  // Own chain first. A correction successor has no unique import-row pointer
  // (the predecessor still holds it). Inheriting THAT chain is truthful reuse
  // of the original evidence. A new observation has no `supersedes` and so
  // cannot inherit May's file as proof of August's money.
  const own = ownEvidenceBatch(row);
  const inherited = inheritedCorrectionEvidenceBatch(row);
  const evidenceBatch = own ?? inherited;
  const importBatchLinked = Boolean(evidenceBatch);
  return {
    importBatchLinked,
    // A BOOLEAN OFF A POINTER, NEVER THE POINTER. `sourceStorageRef` is a
    // content-addressed internal path; what a reader needs is the yes/no.
    originalFileRetained: Boolean(evidenceBatch?.sourceStorageRef),
    sourcePeriodLabel: row.sourcePeriodLabel ?? null,
    effectiveDateProvenance: row.effectiveDateProvenance ?? null,
    effectiveDateDerivationRule: row.effectiveDateDerivationRule ?? null,
    kdnSourceSummary: kdnSourceSummaryOf(row),
    observationBasis: observationBasisOf(row, importBatchLinked),
  };
}

/**
 * %KDN, PROJECTED — AND NEVER INVENTED.
 *
 * Three states, three different answers, and the difference between the last
 * two is the entire reason this function exists rather than a `?? 0`:
 *
 *   "72.50"  a stated fact          -> the screen prints 72,50%
 *   "0.00"   ALSO a stated fact     -> the screen prints 0,00%
 *   null     nobody has said        -> the screen says "Belum tersedia"
 *
 * A missing value coerced to zero would read on screen as a compliance claim
 * SIMPROK was never told, which is exactly the class of invented certainty this
 * whole gate exists to refuse.
 */
export function mapBasicPriceDomesticContent(
  row: DetailRowSource,
): BasicPriceDomesticContent {
  const stated = row.kdnPercent;
  return {
    kdnPercent:
      stated === null || stated === undefined ? null : toDecimalString2(stated),
  };
}

function kdnSourceSummaryOf(row: DetailRowSource): string | null {
  const stated = row.kdnPercent;
  if (stated === null || stated === undefined) return null;
  if (row.kdnEstablishment === 'MANUAL_ENRICHMENT') {
    return 'Dilengkapi kemudian';
  }
  if (row.kdnEstablishment === 'MANUAL_CORRECTION') {
    return 'Koreksi nilai sebelumnya';
  }
  if (row.kdnEstablishment === 'MANUAL_NEW_OBSERVATION') {
    return 'Informasi KDN terbaru';
  }
  const header = row.sourceImportRow?.sourceKdnHeaderText?.trim();
  const fileName = row.sourceImportRow?.batch?.sourceFileName?.trim();
  if (header && fileName) {
    return `Kolom ${header} pada berkas ${fileName}`;
  }
  if (header) return `Kolom ${header}`;
  if (row.kdnEstablishment === 'SOURCE_IMPORT_ROW') {
    return 'Dari berkas harga dasar yang sama';
  }
  return 'Tercatat pada observasi ini';
}

export function mapBasicPriceCorrectionEntry(
  row: HistoryRowSource,
  state: 'CURRENT' | 'SUPERSEDED',
): BasicPriceCorrectionEntry {
  return {
    price: toDecimalString2(row.value),
    effectiveDate: toIso(row.effectiveDate),
    state,
  };
}

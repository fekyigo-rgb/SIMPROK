import { Prisma } from '@prisma/client';
import { toDecimalString2 } from './money';

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
  return region ? { id: region.id, code: region.code, name: region.name } : null;
}

export function mapReviewerIdentity(
  reviewer: { id: string; fullName: string; email: string } | null | undefined,
): ReviewerIdentity | null {
  return reviewer
    ? { userId: reviewer.id, fullName: reviewer.fullName, email: reviewer.email }
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

const currentRevisionOf = (submission: SubmissionSource): RevisionSource | null =>
  submission.revisions.find((revision) => revision.id === submission.currentRevisionId) ??
  null;

const reviewerOf = (source: AssignedUserSource | null): ReviewerIdentity | null =>
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

export function mapPublicationQueueItem(row: BasicPriceRowSource): PublicationQueueItem {
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

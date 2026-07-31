// Pure display/derivation helpers for the RM-02D2A2 Basic Price review &
// publication user journey. Mirrors the backend projection contracts
// (backend/src/common/basic-price-workflow.projection.ts) exactly. No fetch,
// no import.meta here — this module is imported by node:test unit tests, so it
// must stay pure and dependency-light. Money is ALWAYS a decimal string and is
// formatted through formatBackendRupiah (string arithmetic), never Number().
// Explicit .ts extension (allowImportingTsExtensions) so this module resolves
// identically under Vite/tsc and under node:test — reusing the one canonical
// string-based Rupiah formatter instead of duplicating it.
import { formatBackendRupiah } from './rabCostDisplay.ts';

// ── Projection contract types (must match the backend byte-for-byte) ─────────

export interface ResourceIdentity {
  id: string;
  code: string | null;
  name: string;
  type: string;
}

export interface RegionIdentity {
  id: string;
  code: string;
  name: string;
}

export interface ReviewerIdentity {
  userId: string;
  fullName: string;
  email: string;
}

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

export interface PublicationQueueItem {
  basicPriceId: string;
  resource: ResourceIdentity;
  region: RegionIdentity | null;
  price: string;
  effectiveDate: string;
  status: string;
  verificationStatus: string;
  createdAt: string;
}

export interface RegionLookupItem {
  id: string;
  code: string;
  name: string;
}

// ── Human-readable labels (never a raw UUID) ─────────────────────────────────

export const resourceLabel = (resource: ResourceIdentity): string =>
  resource.code ? `${resource.code} — ${resource.name}` : resource.name;

export const regionLabel = (region: RegionIdentity | null): string =>
  region ? `${region.code} — ${region.name}` : 'Umum (tanpa wilayah)';

export const regionOptionLabel = (region: RegionLookupItem): string =>
  `${region.code} — ${region.name}`;

export const reviewerLabel = (reviewer: ReviewerIdentity | null): string =>
  reviewer ? `${reviewer.fullName} (${reviewer.email})` : 'Belum ditugaskan';

/**
 * Formats a decimal-string price for display. The value stays a string the
 * whole way through (formatBackendRupiah does base-10 string grouping); it is
 * NEVER passed through Number()/parseFloat(), so exactness is preserved even
 * beyond IEEE-754 safe-integer range. null renders as an honest em dash.
 */
export const formatPrice = (price: string | null): string =>
  price === null ? '—' : formatBackendRupiah(price);

const SLA_STATE_LABELS: Record<string, string> = {
  OPEN: 'Terbuka',
  ESCALATED: 'Dieskalasi',
  EXPIRED: 'Kedaluwarsa',
  RESOLVED: 'Selesai',
};
export const slaStateLabel = (slaState: string): string =>
  SLA_STATE_LABELS[slaState] ?? slaState;

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Diajukan',
  UNDER_REVIEW: 'Sedang ditinjau',
  VERIFIED: 'Terverifikasi',
  REJECTED: 'Ditolak',
  NEEDS_CORRECTION: 'Perlu koreksi',
};
export const submissionStatusLabel = (status: string): string =>
  SUBMISSION_STATUS_LABELS[status] ?? status;

const REVIEW_ACTION_LABELS: Record<string, string> = {
  ACCEPT: 'Diterima',
  REJECT: 'Ditolak',
  REASSIGN: 'Dialihkan',
  REQUEST_CORRECTION: 'Minta koreksi',
};
export const reviewActionLabel = (action: string): string =>
  REVIEW_ACTION_LABELS[action] ?? action;

// ── Available review actions (REQUEST_CORRECTION deliberately excluded) ──────

/**
 * The review actions the D2A2 UI exposes. request-correction is intentionally
 * ABSENT: the backend route exists but the resubmission path is not approved
 * or tested, so exposing it would be a dead/false door (Hukum Pintu).
 */
export const REVIEW_ACTIONS = ['accept', 'reject', 'reassign'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REQUEST_CORRECTION_AVAILABLE = false as const;

export const isReviewActionAvailable = (action: string): boolean =>
  (REVIEW_ACTIONS as readonly string[]).includes(action);

// ── Action preconditions (mirror the backend fail-closed rules) ──────────────

/** Reject/reject-note is required and must be non-blank (backend 409s otherwise). */
export const canReject = (note: string): boolean => note.trim().length > 0;

/**
 * When a submission has no region, ACCEPT must be an explicit "general region"
 * decision — the backend rejects an ambiguous accept with
 * REGION_REQUIRED_OR_EXPLICIT_GENERAL_REGION.
 */
export const acceptNeedsExplicitGeneralRegion = (region: RegionIdentity | null): boolean =>
  region === null;

export const buildRejectBody = (note: string): { note: string } => ({ note: note.trim() });

export const buildReassignBody = (params: {
  assignedToUserId: string | null;
  note?: string;
}): { assignedToUserId: string | null; note?: string } => ({
  assignedToUserId: params.assignedToUserId,
  ...(params.note && params.note.trim() ? { note: params.note.trim() } : {}),
});

export const buildAcceptBody = (params: {
  explicitGeneralRegion: boolean;
  note?: string;
}): { explicitGeneralRegion?: boolean; note?: string } => ({
  ...(params.explicitGeneralRegion ? { explicitGeneralRegion: true } : {}),
  ...(params.note && params.note.trim() ? { note: params.note.trim() } : {}),
});

// ── Honest UI states (loading / empty / forbidden / not-found / conflict …) ──

export type WorkflowErrorState = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'SERVER_ERROR' | 'ERROR';

export const errorStateFromStatus = (status: number): WorkflowErrorState => {
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status >= 500) return 'SERVER_ERROR';
  return 'ERROR';
};

export const WORKFLOW_ERROR_MESSAGES: Record<WorkflowErrorState, string> = {
  FORBIDDEN: 'Anda tidak memiliki wewenang untuk tindakan ini di workspace ini.',
  NOT_FOUND: 'Data tidak ditemukan. Mungkin sudah berubah — muat ulang halaman.',
  CONFLICT: 'Keadaan sudah berubah sejak halaman dimuat. Muat ulang lalu coba lagi.',
  SERVER_ERROR: 'Terjadi kesalahan pada server. Coba lagi nanti.',
  ERROR: 'Terjadi kesalahan. Coba lagi.',
};

export const errorMessageFromStatus = (status: number): string =>
  WORKFLOW_ERROR_MESSAGES[errorStateFromStatus(status)];

// ── Status banner (a success message survives a refetch) ─────────────────────

export type BannerKind = 'idle' | 'loading' | 'ready' | 'empty' | 'success' | 'error';

export interface StatusBanner {
  kind: BannerKind;
  text: string;
  /** A sticky success banner is NOT overwritten by a follow-up refetch. */
  sticky: boolean;
}

export const banner = (kind: BannerKind, text: string): StatusBanner => ({
  kind,
  text,
  sticky: false,
});

export const successBanner = (text: string): StatusBanner => ({
  kind: 'success',
  text,
  sticky: true,
});

export const errorBanner = (status: number): StatusBanner => ({
  kind: 'error',
  text: errorMessageFromStatus(status),
  sticky: false,
});

/**
 * After a background refetch resolves, keep a sticky success banner in place
 * instead of stomping it with the neutral list state — a "Berhasil diterbitkan"
 * confirmation must not vanish just because the queue reloaded (J: success
 * message tidak boleh langsung hilang karena refetch/navigation/state reset).
 * A fresh user action replaces the banner explicitly, not through this merge.
 */
export const bannerAfterRefetch = (previous: StatusBanner, next: StatusBanner): StatusBanner =>
  previous.sticky && previous.kind === 'success' ? previous : next;

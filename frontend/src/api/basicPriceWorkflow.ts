// RM-02D2A2 — thin API client for the Basic Price review & publication
// workflow. Same apiFetch() client the rest of the app uses (Authorization +
// x-workspace-id headers); the server resolves organizationId and the acting
// user from context, so this client never sends either. All response types are
// the backend projection contracts, imported from the pure display module.
import { apiFetch } from '../utils/apiClient';
import type {
  PublicationQueueItem,
  RegionLookupItem,
  ReviewDetail,
  ReviewQueueItem,
  ReviewerIdentity,
} from '../utils/basicPriceWorkflowDisplay';

export type {
  PublicationQueueItem,
  RegionLookupItem,
  ReviewDetail,
  ReviewQueueItem,
  ReviewerIdentity,
};

/** Carries the HTTP status so pages can render an honest FORBIDDEN/NOT_FOUND/
 * CONFLICT/SERVER_ERROR state instead of a generic failure. */
export class BasicPriceWorkflowError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message || `HTTP ${status}`);
    this.name = 'BasicPriceWorkflowError';
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw new BasicPriceWorkflowError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const withQuery = (path: string, params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.trim() !== '') search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
};

interface LookupPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

// ── Review queue / detail ─────────────────────────────────────────────────────

export const fetchReviewQueue = (slaState?: string, signal?: AbortSignal): Promise<ReviewQueueItem[]> =>
  requestJson<ReviewQueueItem[]>(withQuery('/basic-price-reviews', { slaState }), { signal });

export const fetchReviewDetail = (reviewId: string, signal?: AbortSignal): Promise<ReviewDetail> =>
  requestJson<ReviewDetail>(`/basic-price-reviews/${encodeURIComponent(reviewId)}`, { signal });

// ── Review actions (actor identity is server-resolved from the JWT) ──────────

export const acceptReview = (
  reviewId: string,
  body: { explicitGeneralRegion?: boolean; note?: string },
): Promise<unknown> =>
  requestJson(`/basic-price-reviews/${encodeURIComponent(reviewId)}/accept`, jsonInit('POST', body));

export const rejectReview = (reviewId: string, body: { note: string }): Promise<unknown> =>
  requestJson(`/basic-price-reviews/${encodeURIComponent(reviewId)}/reject`, jsonInit('POST', body));

export const reassignReview = (
  reviewId: string,
  body: { assignedToUserId: string | null; note?: string },
): Promise<unknown> =>
  requestJson(`/basic-price-reviews/${encodeURIComponent(reviewId)}/reassign`, jsonInit('POST', body));

// ── Active-reviewer directory (reassign selector) ────────────────────────────

export const fetchReviewerCandidates = (q?: string, signal?: AbortSignal): Promise<ReviewerIdentity[]> =>
  requestJson<ReviewerIdentity[]>(withQuery('/basic-price-reviews/reviewer-candidates', { q }), { signal });

// ── Publication ───────────────────────────────────────────────────────────────

export const fetchPublicationQueue = (signal?: AbortSignal): Promise<PublicationQueueItem[]> =>
  requestJson<PublicationQueueItem[]>('/basic-price-publications', { signal });

export const publishBasicPrice = (basicPriceId: string): Promise<unknown> =>
  requestJson(`/basic-price-publications/${encodeURIComponent(basicPriceId)}/publish`, { method: 'POST' });

// ── Region lookup (import Region selector) ────────────────────────────────────

export const searchRegions = async (q?: string, signal?: AbortSignal): Promise<RegionLookupItem[]> => {
  const page = await requestJson<LookupPage<RegionLookupItem>>(
    withQuery('/basic-price-import-lookups/regions', { q, limit: '20' }),
    { signal },
  );
  return page.items;
};

// RM02D2A2 — thin API client for the Basic Price Explorer, the primary,
// public-facing Basic Price door (Owner Lock: PRIMARY_BASIC_PRICE_DOOR =
// EXPLORER). Reuses the same apiFetch() client (Authorization + x-workspace-id
// headers) and the canonical GET /basic-prices route — no parallel explorer
// endpoint. The server resolves the workspace from the auth context; this
// client never sends a client-supplied workspaceId.
import { apiFetch } from '../utils/apiClient';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay';
import type {
  BasicPriceCorrectionEntry,
  BasicPriceCorrectionHistory,
  BasicPriceDetail,
  BasicPriceEvidenceFacts,
  BasicPriceExplorerItem,
  ExplorerFilters,
  ExplorerPageMeta,
  RegionLookupItem,
} from '../utils/basicPriceExplorerDisplay';

export type {
  BasicPriceCorrectionEntry,
  BasicPriceCorrectionHistory,
  BasicPriceDetail,
  BasicPriceEvidenceFacts,
  BasicPriceExplorerItem,
  ExplorerFilters,
  ExplorerPageMeta,
  RegionLookupItem,
};

/** Carries the HTTP status so the page can render an honest FORBIDDEN/INVALID_FILTER/SERVER_ERROR state. */
export class BasicPriceExplorerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message || `HTTP ${status}`);
    this.name = 'BasicPriceExplorerError';
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw new BasicPriceExplorerError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

const withQuery = (path: string, params: Record<string, string>): string => {
  const search = new URLSearchParams(params);
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
};

export interface ExplorerPage {
  data: BasicPriceExplorerItem[];
  meta: ExplorerPageMeta;
}

export const fetchBasicPriceExplorer = (
  filters: ExplorerFilters,
  signal?: AbortSignal,
): Promise<ExplorerPage> =>
  requestJson<ExplorerPage>(withQuery('/basic-prices', buildExplorerQueryParams(filters)), { signal });

/**
 * BP-UX-FINAL-01C — the projected detail + real price history for ONE price.
 *
 * ON DEMAND ONLY. This is called when a person opens the freshness layer or the
 * Detail panel — never once per Explorer row. The list stays exactly one
 * paginated request; fetching a history for twenty rows nobody opened would be
 * an N+1 paid for on every page load.
 *
 * A SEPARATE ROUTE FROM `GET /basic-prices/:id`, deliberately: that one still
 * returns a raw entity because twelve end-to-end assertions read `status`,
 * `verificationStatus` and `assetScope` straight off it. This route is the
 * browser's door — explicit allow-listed projection, no internal columns, no
 * foreign identifiers.
 */
export const fetchBasicPriceDetail = (
  basicPriceId: string,
  signal?: AbortSignal,
): Promise<BasicPriceDetail> =>
  requestJson<BasicPriceDetail>(
    `/basic-prices/${encodeURIComponent(basicPriceId)}/detail`,
    { signal },
  );

interface LookupPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

/**
 * Explorer-scoped Region lookup (GET /basic-prices/lookups/regions), gated by
 * BASIC_PRICE_VIEW. Deliberately NOT the import lookup
 * (/basic-price-import-lookups/regions, gated by BASIC_PRICE_IMPORT) — a
 * caller with only view access must never need import permission just to
 * search regions.
 */
export const searchExplorerRegions = async (q?: string, signal?: AbortSignal): Promise<RegionLookupItem[]> => {
  const page = await requestJson<LookupPage<RegionLookupItem>>(
    withQuery('/basic-prices/lookups/regions', q && q.trim() ? { q: q.trim(), limit: '20' } : { limit: '20' }),
    { signal },
  );
  return page.items;
};

/** BP-C3 read-only impact preview for an ACTIVE workspace ResourceCatalog. No rename. */
export interface CatalogNameImpact {
  currentName: string;
  proposedName: string;
  resourceType: string;
  resourceCode: string | null;
  baseUnit: string;
  hasSpecifications: boolean;
  specificationFacts: Array<{ name: string; value: string }>;
  observedVersion: string;
  impact: {
    basicPrices: number;
    projectAhspResolutions: number;
    importRows: number;
    sourceIdentityRecords: number;
    conversionRules: number;
  };
  conflictingSameTypeNames: number;
  verdict: 'IDENTITY_CONFLICT_REVIEW_REQUIRED' | 'SPELLING_ONLY_PREVIEW' | 'NOMENCLATURE_VERIFICATION_REQUIRED' | 'NO_CHANGE' | 'IDENTITY_REVIEW_REQUIRED';
  writable: false;
  message: string;
}
export const previewCatalogNameImpact = (
  resourceCatalogId: string, proposedName: string,
): Promise<CatalogNameImpact> =>
  requestJson<CatalogNameImpact>(
    withQuery('/basic-prices/catalog-name-impact/' + encodeURIComponent(resourceCatalogId), { proposedName }),
  );

/** BP-C3: only the existing workspace identity curator can commit a proven
 * same-identity typography correction; the backend does all authorization. */
export const correctActiveResourceCatalogName = (resourceCatalogId: string, input: {
  previousName: string;
  correctedName: string;
  expectedUpdatedAt: string;
  reason: string;
  evidence: string;
  sameIdentityConfirmed: true;
  nomenclatureVerified?: boolean;
  confirmedCatalogCode?: string;
  sourceReference?: string;
}): Promise<{ corrected: true; previousName: string; correctedName: string }> =>
  requestJson(
    '/resource-observations/catalog/' + encodeURIComponent(resourceCatalogId) + '/correct-name',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );

// BP-MULTI-ACTION-01 — a private owner's governed withdrawal, not physical delete.
// Reuses the canonical BasicPrice writer/authority and existing API credentials.
export const removeOwnBasicPrice = async (
  basicPriceId: string,
): Promise<{ basicPriceId: string; removed: true; alreadyRemoved: boolean }> =>
  requestJson(`/basic-prices/${encodeURIComponent(basicPriceId)}`, { method: 'DELETE' });

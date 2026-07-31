// RM02D2A2 — thin API client for the Basic Price Explorer, the primary,
// public-facing Basic Price door (Owner Lock: PRIMARY_BASIC_PRICE_DOOR =
// EXPLORER). Reuses the same apiFetch() client (Authorization + x-workspace-id
// headers) and the canonical GET /basic-prices route — no parallel explorer
// endpoint. The server resolves the workspace from the auth context; this
// client never sends a client-supplied workspaceId.
import { apiFetch } from '../utils/apiClient';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay';
import type {
  BasicPriceExplorerItem,
  ExplorerFilters,
  ExplorerPageMeta,
  RegionLookupItem,
} from '../utils/basicPriceExplorerDisplay';

export type { BasicPriceExplorerItem, ExplorerFilters, ExplorerPageMeta, RegionLookupItem };

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

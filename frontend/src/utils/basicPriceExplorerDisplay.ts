// Pure display/derivation helpers for the RM02D2A2 Basic Price Explorer — the
// primary, public-facing Basic Price door (Owner Lock: PRIMARY_BASIC_PRICE_DOOR
// = EXPLORER). Mirrors the backend projection contract
// (backend/src/common/basic-price-workflow.projection.ts, mapExplorerItem)
// exactly. No fetch, no import.meta here — this module is imported by
// node:test unit tests, so it must stay pure and dependency-light. Money is
// ALWAYS a decimal string and is formatted through formatBackendRupiah
// (string arithmetic), never Number().
import { formatBackendRupiah } from './rabCostDisplay.ts';
import {
  resourceLabel,
  regionLabel,
  regionOptionLabel,
  regionChosenLabel,
  regionOptionLabels,
} from './basicPriceWorkflowDisplay.ts';
import type { RegionIdentity, RegionLookupItem } from './basicPriceWorkflowDisplay.ts';

export {
  resourceLabel,
  regionLabel,
  regionOptionLabel,
  regionChosenLabel,
  regionOptionLabels,
};
export type { RegionIdentity, RegionLookupItem };

// ── Projection contract types (must match the backend byte-for-byte) ────────

export interface ExplorerResourceIdentity {
  id: string;
  code: string | null;
  name: string;
  type: string;
  baseUnit: string;
}

export type BasicPriceWorkspaceScope = 'WORKSPACE' | 'GLOBAL';

export interface BasicPriceExplorerItem {
  basicPriceId: string;
  resource: ExplorerResourceIdentity;
  region: RegionIdentity | null;
  price: string;
  effectiveDate: string;
  validUntil: string | null;
  sourceType: string;
  sourceOrigin: string;
  sourceName: string | null;
  freshnessStatus: string;
  /**
   * SOFT RE-VERIFICATION — the date SIMPROK recommends this price be checked
   * again, or null when it recommends nothing. It is NOT `validUntil`, and the
   * two must never share wording: `validUntil` is a hard boundary the Cost
   * Kernel actually enforces, this is advice.
   */
  reviewDate?: string | null;
  reverification?: 'CURRENT' | 'DUE' | 'NOT_RECOMMENDED';
  workspaceScope: BasicPriceWorkspaceScope;
}

export interface ExplorerPageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExplorerFilters {
  search?: string;
  regionId?: string;
  year?: string;
  dateFrom?: string;
  dateTo?: string;
  sourceOrigin?: string;
  sourceFamily?: string;
  sourceName?: string;
  unit?: string;
  freshnessStatus?: string;
  resourceType?: string;
  page?: number;
  limit?: number;
  sortBy?: 'effectiveDate' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/** Only the non-empty, defined fields become query params — never a literal "undefined". */
export function buildExplorerQueryParams(filters: ExplorerFilters): Record<string, string> {
  const params: Record<string, string> = {};
  const put = (key: string, value: string | number | undefined) => {
    if (value === undefined) return;
    const text = String(value).trim();
    if (text.length > 0) params[key] = text;
  };
  put('search', filters.search);
  put('regionId', filters.regionId);
  put('year', filters.year);
  put('dateFrom', filters.dateFrom);
  put('dateTo', filters.dateTo);
  put('sourceOrigin', filters.sourceOrigin);
  put('sourceFamily', filters.sourceFamily);
  put('sourceName', filters.sourceName);
  put('unit', filters.unit);
  put('freshnessStatus', filters.freshnessStatus);
  put('resourceType', filters.resourceType);
  put('page', filters.page);
  put('limit', filters.limit);
  put('sortBy', filters.sortBy);
  put('sortOrder', filters.sortOrder);
  return params;
}

/**
 * Client-side honesty check mirroring the backend's own rule: year and an
 * explicit date range describe the same axis, so combining them is rejected
 * before the request is even sent (the backend would 400 anyway).
 */
export const isAmbiguousTimeFilter = (filters: Pick<ExplorerFilters, 'year' | 'dateFrom' | 'dateTo'>): boolean =>
  Boolean(filters.year && (filters.dateFrom || filters.dateTo));

export const isInvalidDateRange = (dateFrom?: string, dateTo?: string): boolean => {
  if (!dateFrom || !dateTo) return false;
  const from = Date.parse(dateFrom);
  const to = Date.parse(dateTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return from > to;
};

// ── Human-readable labels (never a raw UUID) ─────────────────────────────────
// resourceLabel/regionLabel/regionOptionLabel are re-exported above, unchanged
// from the review/publication journey — an ExplorerResourceIdentity is
// structurally a superset of ResourceIdentity (adds baseUnit), so the same
// function applies without a wrapper.

/**
 * Formats a decimal-string price for display. The value stays a string the
 * whole way through (formatBackendRupiah does base-10 string grouping); it is
 * NEVER passed through Number()/parseFloat(), so exactness is preserved even
 * beyond IEEE-754 safe-integer range.
 */
export const formatExplorerPrice = (price: string): string => formatBackendRupiah(price);

/** Honest copy for a missing source — never a fabricated vendor/store name. */
export const explorerSourceNameLabel = (sourceName: string | null): string =>
  sourceName ?? 'Sumber tidak tersedia';

const SOURCE_ORIGIN_LABELS: Record<string, string> = {
  GOVERNMENT: 'Pemerintah',
  SUPPLIER: 'Pemasok',
  STORE: 'Toko',
  DISTRIBUTOR: 'Distributor',
  FIELD_REPORT: 'Laporan Lapangan',
  COMMUNITY_REPORT: 'Laporan Komunitas',
};
export const sourceOriginLabel = (origin: string): string => SOURCE_ORIGIN_LABELS[origin] ?? origin;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  VENDOR_QUOTE: 'Penawaran Vendor',
  MARKET_SURVEY: 'Survei Pasar',
  REGULATION: 'Regulasi',
  SYSTEM_ESTIMATE: 'Estimasi Sistem',
};
export const sourceTypeLabel = (type: string): string => SOURCE_TYPE_LABELS[type] ?? type;

const FRESHNESS_LABELS: Record<string, string> = {
  CURRENT: 'Terkini',
  EXPIRING: 'Akan Kedaluwarsa',
  EXPIRED: 'Kedaluwarsa',
};
export const freshnessLabel = (status: string): string => FRESHNESS_LABELS[status] ?? status;

export const workspaceScopeLabel = (scope: BasicPriceWorkspaceScope): string =>
  scope === 'WORKSPACE' ? 'Workspace Anda' : 'Umum (Global)';

// Category filter — canonical ResourceCatalog.type, human label only.
export const RESOURCE_TYPE_OPTIONS = ['MATERIAL', 'LABOR', 'EQUIPMENT'] as const;
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  MATERIAL: 'Material/Bahan',
  LABOR: 'Upah/Tenaga Kerja',
  EQUIPMENT: 'Peralatan',
};
export const resourceTypeLabel = (type: string): string => RESOURCE_TYPE_LABELS[type] ?? type;

// Owner-locked human source-family grouping over sourceOrigin (no new enum).
export const SOURCE_FAMILY_OPTIONS = ['GOVERNMENT', 'STORE_SUPPLIER', 'FIELD_PRICE'] as const;
const SOURCE_FAMILY_LABELS: Record<string, string> = {
  GOVERNMENT: 'Harga Pemerintah',
  STORE_SUPPLIER: 'Harga Toko/Supplier',
  FIELD_PRICE: 'Harga Lapangan',
};
export const sourceFamilyLabel = (family: string): string => SOURCE_FAMILY_LABELS[family] ?? family;

// ── Honest UI states (loading / empty / forbidden / invalid-filter / error) ──

export type ExplorerErrorState = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_FILTER' | 'SERVER_ERROR' | 'ERROR';

export const explorerErrorStateFromStatus = (status: number): ExplorerErrorState => {
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) return 'INVALID_FILTER';
  if (status >= 500) return 'SERVER_ERROR';
  return 'ERROR';
};

export const EXPLORER_ERROR_MESSAGES: Record<ExplorerErrorState, string> = {
  FORBIDDEN: 'Workspace aktif Anda tidak memiliki kewenangan untuk melihat Harga Dasar.',
  NOT_FOUND: 'Data tidak ditemukan.',
  INVALID_FILTER: 'Filter tidak valid. Periksa kembali tanggal atau kombinasi filter Anda.',
  SERVER_ERROR: 'Terjadi kesalahan pada server. Coba lagi nanti.',
  ERROR: 'Terjadi kesalahan. Coba lagi.',
};

export const explorerErrorMessageFromStatus = (status: number): string =>
  EXPLORER_ERROR_MESSAGES[explorerErrorStateFromStatus(status)];

export const EXPLORER_EMPTY_STATE_TITLE = 'Belum ada Basic Price yang dipublikasikan.';
export const EXPLORER_EMPTY_STATE_BODY =
  'Harga yang telah melewati proses verifikasi dan publikasi akan tampil di sini.';

export const EXPLORER_NO_MATCH_TITLE = 'Tidak ada harga dasar yang cocok dengan filter ini.';

/**
 * RE-VERIFICATION, IN THE USER'S OWN WORDS.
 *
 * `Verifikasi ulang pada` — never `Berlaku sampai`, which belongs to
 * `validUntil` and means something the system actually enforces. A price past
 * its re-verification date is still a lawful, usable price; SIMPROK is asking
 * for a second look, not withdrawing permission.
 */
export const REVERIFICATION_LABEL = 'Verifikasi ulang pada';
export const REVERIFICATION_DUE_BADGE = 'Perlu verifikasi ulang';

/**
 * THE HELP A PERSON GETS WHEN THEY ASK WHAT THE DATE MEANS.
 *
 * Deliberately free of field names, enum values and backend vocabulary: a
 * reader needs to know what will happen to their price, not what the column is
 * called. Kept here beside the label so the explanation and the wording can
 * never drift apart.
 */
export const REVERIFICATION_HELP_TRIGGER = 'Apa maksud tanggal ini?';

export const REVERIFICATION_HELP_TEXT = [
  'Ini adalah perkiraan waktu harga perlu diperiksa kembali karena harga pasar dapat berubah. Melewati tanggal ini tidak otomatis membuat harga salah atau tidak boleh digunakan. SIMPROK hanya mengingatkan agar harga diverifikasi dan diperbarui bila memang sudah berubah.',
  'Gunakan untuk harga hasil survei, laporan lapangan, quotation/manual snapshot, atau sumber lain yang tidak diperbarui otomatis.',
  // 'freshness' was the one English word left in a sentence meant for a site
  // engineer. The fact it names is ordinary and has ordinary Indonesian words.
  'Untuk harga pemasok/toko yang terhubung langsung dan diperbarui otomatis oleh sistem, kemutakhiran harga mengikuti waktu pembaruan yang sebenarnya sehingga tanggal prediksi ini tidak diperlukan.',
] as const;

/**
 * One line about re-verification, or null when there is nothing to say.
 *
 * `NOT_RECOMMENDED` returns null on purpose: a live-integrated price was never
 * given a predicted date, and rendering an empty or "-" value there would
 * suggest a missing fact rather than a deliberate absence.
 */
export const reverificationLine = (
  item: Pick<BasicPriceExplorerItem, 'reviewDate' | 'reverification'>,
  formatDate: (iso: string) => string,
): string | null => {
  if (!item.reviewDate || item.reverification === 'NOT_RECOMMENDED') return null;
  const base = `${REVERIFICATION_LABEL} ${formatDate(item.reviewDate)}`;
  return item.reverification === 'DUE' ? `${base} · ${REVERIFICATION_DUE_BADGE}` : base;
};

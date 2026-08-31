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
  /**
   * RM-03C — WHICH ASSET FAMILY THIS ROW BELONGS TO.
   *
   * The server has sent this since RM-03C and this mirror simply never named
   * it, so the Explorer could not tell a workspace's OWN private price apart
   * from a curated catalog row. That is the difference between "we imported
   * this ourselves" and "SIMPROK published this", and it belongs on the
   * Detail's evidence tab rather than being inferred from `workspaceScope`,
   * which answers a different question (tenancy, not curation).
   *
   * Optional, because the review/publication projections and older fixtures do
   * not carry it — an absent value reads as unknown, never as catalog.
   */
  assetScope?: BasicPriceAssetScope;
}

export type BasicPriceAssetScope = 'WORKSPACE_PRIVATE' | 'SIMPROK_CATALOG';

export interface ExplorerPageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * BP-UX-FINAL-01D — THE PROJECTED DETAIL READ (GET /basic-prices/:id/detail).
 *
 * Mirrors `backend/src/common/basic-price-workflow.projection.ts` exactly. The
 * price half is the SAME `BasicPriceExplorerItem` the list row used — one
 * projection, two screens — so Detail and the table can never disagree about
 * what a price is called, what it costs or where it came from.
 */

/**
 * ONE CORRECTION. NOT one price observation.
 *
 * The server reads `BasicPrice.supersedesBasicPriceId`, which carries exactly
 * one sentence: a human published this price as an explicit CORRECTION of that
 * erroneous one. A later, equally valid observation of the same market carries
 * no such pointer and is not here. Everything on screen therefore says
 * KOREKSI — never "riwayat harga", which would promise a completeness this
 * column cannot give.
 *
 * NO `basicPriceId`. Rendering a dated amount needs no identifier, so a
 * predecessor's raw UUID is not sent and this list is keyed by position.
 */
export interface BasicPriceCorrectionEntry {
  /** Exact decimal string. Never passed through Number() at any depth. */
  price: string;
  effectiveDate: string;
  /**
   * SUPERSEDED only when an exact `supersedesBasicPriceId` pointer names this
   * row. Never inferred from age, value or date order.
   */
  state: 'CURRENT' | 'SUPERSEDED';
}

/**
 * The correction lineage, and whether it is all of it.
 *
 * The server's read is BOUNDED, so `truncated` is how it admits stopping short.
 * It is the difference between the heading "Riwayat Koreksi" and "Riwayat
 * Koreksi Terbaru", and neither heading is ever a claim about the full set of
 * price observations.
 */
export interface BasicPriceCorrectionHistory {
  entries: BasicPriceCorrectionEntry[];
  truncated: boolean;
}

/**
 * What SIMPROK can actually PROVE about where this price came from.
 *
 * TWO FACTS, AND THE DISTANCE BETWEEN THEM IS THE WHOLE POINT.
 *
 *   importBatchLinked     this price is linked to a recorded import batch. A
 *                         RELATION, and nothing at all about a file.
 *   originalFileRetained  that batch's ORIGINAL BYTES are still retained.
 *                         Only this one licenses a sentence about the uploaded
 *                         file still being held.
 *
 * The panel used to state the stronger sentence unconditionally, for every row,
 * including rows with no provenance chain whatsoever. Each sentence is now
 * gated on the fact that proves it, and on no weaker one.
 */
export interface BasicPriceEvidenceFacts {
  importBatchLinked: boolean;
  originalFileRetained: boolean;
  sourcePeriodLabel: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
  /** Human-readable %KDN origin. Null when unstated or no public sentence. */
  kdnSourceSummary: string | null;
  observationBasis: 'SOURCE_DOCUMENT' | 'FIELD_REPORTED' | null;
}

/**
 * %KDN — the DOMESTIC-CONTENT fact of the RESOURCE this price is for.
 *
 * NOT TKDN. %KDN is an item/resource/Basic Price level FACT; TKDN is a
 * CALCULATED aggregate at RAB/Project level. This screen shows the first and
 * computes nothing.
 *
 * `null` means nobody has stated a value — which is NOT `0`. Zero is itself a
 * substantive claim ("no domestic content"), so the two must never render the
 * same way.
 */
export interface BasicPriceDomesticContent {
  /** Exact decimal string, two digits (e.g. "72.50"), or null when unstated. */
  kdnPercent: string | null;
}

export interface BasicPriceDetail {
  price: BasicPriceExplorerItem;
  evidence: BasicPriceEvidenceFacts;
  corrections: BasicPriceCorrectionHistory;
  domesticContent: BasicPriceDomesticContent;
}

/** Shown while the lawful detail read is still in flight. */
export const KDN_PENDING_LABEL = 'Memuat...';
/** Shown when the read completed and NO domestic-content fact was stated. */
export const KDN_UNAVAILABLE_LABEL = 'Belum tersedia';

/**
 * THE THREE STATES, AND WHY `undefined` AND `null` MUST DIFFER.
 *
 *   undefined  the detail read has not answered yet  -> "Memuat..."
 *   null       it answered, and nothing was stated   -> "Belum tersedia"
 *   "72.50"    it answered with a fact               -> "72,50%"
 *   "0.00"     ALSO a fact                           -> "0,00%"
 *
 * Collapsing absence into `0%` would print a compliance claim SIMPROK was never
 * given. Collapsing "not yet loaded" into "Belum tersedia" would print an
 * absence SIMPROK has not finished checking. Both are lies of a different size.
 *
 * The decimal separator is a comma because the rest of this room is Indonesian;
 * the value itself is never passed through Number(), so exactness survives.
 */
export const kdnLabel = (kdnPercent: string | null | undefined): string => {
  if (kdnPercent === undefined) return KDN_PENDING_LABEL;
  if (kdnPercent === null) return KDN_UNAVAILABLE_LABEL;
  return `${kdnPercent.replace('.', ',')}%`;
};

export interface ExplorerFilters {
  search?: string;
  regionId?: string;
  year?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * "Berlaku pada tanggal" — the APPLICABILITY lens, and a different axis from
   * the `dateFrom`/`dateTo`/`year` range filters above.
   *
   * The server answers it with the full temporal law the AHSP resolver and the
   * Cost Kernel already enforce (effectiveDate <= asOf, validUntil null or
   * >= asOf, currentness evaluated AT asOf). The browser sends one date and
   * computes none of that itself — duplicating any of it here would be a second
   * copy of currentness law, drifting the moment the server's rule changed.
   */
  asOf?: string;
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
  put('asOf', filters.asOf);
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

const OBSERVATION_BASIS_LABELS: Record<string, string> = {
  SOURCE_DOCUMENT: 'Dokumen sumber',
  FIELD_REPORTED: 'Hasil survei/laporan lapangan',
};
export const observationBasisLabel = (basis: string): string =>
  OBSERVATION_BASIS_LABELS[basis] ?? basis;

const FRESHNESS_LABELS: Record<string, string> = {
  CURRENT: 'Terkini',
  EXPIRING: 'Akan Kedaluwarsa',
  EXPIRED: 'Kedaluwarsa',
};
export const freshnessLabel = (status: string): string => FRESHNESS_LABELS[status] ?? status;

export const workspaceScopeLabel = (scope: BasicPriceWorkspaceScope): string =>
  scope === 'WORKSPACE' ? 'Ruang kerja Anda' : 'Umum (Global)';

/**
 * WHO CURATED THIS PRICE — a different question from who owns it.
 *
 * An absent value is reported as unknown rather than defaulted to catalog:
 * telling a person a price passed SIMPROK's curation when the payload never
 * said so would be the exact kind of unearned claim the projection's own
 * fail-safe direction exists to prevent.
 */
export const assetScopeLabel = (scope: BasicPriceAssetScope | undefined): string => {
  if (scope === 'WORKSPACE_PRIVATE') return 'Ruang kerja Anda';
  if (scope === 'SIMPROK_CATALOG') return 'Katalog SIMPROK';
  return 'Tidak dinyatakan';
};

/**
 * ONE CAKUPAN FIELD — tenancy and curation family, without duplicating two
 * nearly-identical scope rows on Detail.
 */
export const cakupanLabel = (
  item: Pick<BasicPriceExplorerItem, 'assetScope' | 'workspaceScope'>,
): string => {
  if (item.assetScope === 'WORKSPACE_PRIVATE') return 'Ruang kerja Anda';
  if (item.assetScope === 'SIMPROK_CATALOG') return 'Katalog SIMPROK';
  return workspaceScopeLabel(item.workspaceScope);
};

/** Evidence note when original upload bytes are still retained. */
export const EVIDENCE_FILE_RETAINED_NOTE =
  'Berkas sumber tersimpan di SIMPROK dan tidak ditampilkan di sini.';

/**
 * "BERLAKU PADA TANGGAL" — AND NOW IT MEANS EXACTLY THAT.
 *
 * THE PREVIOUS WORDING WAS HONEST ABOUT A WEAKER QUERY. The control sent
 * `dateTo=D`, which is only `effectiveDate <= D`, so the help text could
 * truthfully promise no more than "started on or before this date" — and the
 * resulting list still contained prices whose own source said they had expired,
 * and prices a published correction had already replaced.
 *
 * `asOf=D` asks the whole question server-side, through the same temporal law
 * the AHSP resolver and the Cost Kernel already enforce:
 *
 *     effectiveDate <= D
 *     AND (validUntil IS NULL OR validUntil >= D)
 *     AND currentness evaluated AT D
 *
 * NONE OF WHICH IS COMPUTED HERE. The browser sends one date. A second copy of
 * validity or currentness law in this file would drift from the one the money
 * is spent through, and the screen would start disagreeing with the engine.
 */
export const EFFECTIVE_ON_DATE_HELP = 'Harga yang berlaku pada tanggal ini.';

/**
 * WHERE `effectiveDate` CAME FROM — in words, or not at all.
 *
 * RM-03D1 records whether the source STATED the date or SIMPROK DERIVED it from
 * a coarser period. That distinction is worth showing on an evidence tab; the
 * enum spelling is not. An unrecognised or absent value returns null so the
 * screen renders NOTHING — a raw `DERIVED_FROM_SOURCE_PERIOD` in front of a
 * site engineer is not a fact, it is a leak of vocabulary.
 */
export const effectiveDateProvenanceLabel = (
  provenance: string | null | undefined,
): string | null => {
  if (provenance === 'SOURCE_STATED') return 'Dinyatakan langsung oleh sumber';
  if (provenance === 'DERIVED_FROM_SOURCE_PERIOD') {
    return 'Diturunkan SIMPROK dari periode sumber';
  }
  return null;
};

/**
 * Said out loud when a person has chosen a date OTHER than today, so an
 * as-of lens can never be mistaken for the present-day list (§C).
 */
export const asOfContextLine = (
  isoDate: string,
  formatDate: (iso: string) => string,
): string => `Menampilkan harga yang berlaku pada ${formatDate(isoDate)}.`;

// Category filter — canonical ResourceCatalog.type, human label only.
export const RESOURCE_TYPE_OPTIONS = ['MATERIAL', 'LABOR', 'EQUIPMENT'] as const;
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  MATERIAL: 'Bahan',
  LABOR: 'Tenaga kerja',
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

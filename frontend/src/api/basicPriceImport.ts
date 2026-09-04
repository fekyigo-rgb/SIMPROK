// Thin wrapper around the shared apiFetch() for the RM-02 Basic Price
// import endpoints. Not a new HTTP mechanism — same fetch/apiFetch client
// as the rest of the app, just grouped by resource instead of inlined into
// a page (the pages are large enough on their own already).
import { apiFetch } from '../utils/apiClient';
import type { BasicPriceImportBatchSummary } from '../utils/basicPriceImportDisplay';
// The catalog and unit vocabularies live at the bottom of the dependency chain
// (see basicPriceImportDisplay) and are re-exported here so every existing
// importer of this module keeps working against ONE definition of each.
export type {
  ResourceType,
  UnitDimension,
  UnitKind,
} from '../utils/basicPriceImportDisplay';
import type {
  ResourceType,
  UnitDimension,
  UnitKind,
} from '../utils/basicPriceImportDisplay';
import { buildLookupPath } from '../utils/catalogSearch';
// The one law that decides whether a failed response is intake speaking about
// the document, or something else entirely. See basicPriceIntakeErrors.
import { isIntakeRefusalCode } from '../utils/basicPriceIntakeErrors';

export type PriceSourceType = 'VENDOR_QUOTE' | 'MARKET_SURVEY' | 'REGULATION' | 'SYSTEM_ESTIMATE';
export type PriceSourceOrigin = 'GOVERNMENT' | 'SUPPLIER' | 'STORE' | 'DISTRIBUTOR' | 'FIELD_REPORT' | 'COMMUNITY_REPORT';
export type PriceTableStructure = 'SECTIONED_PRICE_LIST' | 'SEMANTIC_HEADER_TABLE' | 'REGIONAL_MATRIX';

export interface ResourceLookupItem {
  id: string;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  status: 'ACTIVE';
}

export interface UnitLookupItem {
  id: string;
  code: string;
  displayName: string;
  symbol: string;
  dimension: UnitDimension;
  kind: UnitKind;
}

export interface LookupPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

export interface ResourceLookupQuery {
  q?: string;
  type?: ResourceType;
  page?: number;
  limit?: number;
}

export interface UnitLookupQuery {
  q?: string;
  dimension?: UnitDimension;
  kind?: UnitKind;
  page?: number;
  limit?: number;
}

export interface BasicPriceImportMetadata {
  regionId?: string;
  effectiveDate?: string;
  /** Soft re-verification, stated by a person. Never derived. */
  reviewDate?: string;
  sourceType?: PriceSourceType;
  sourceOrigin?: PriceSourceOrigin;
  sourceOrganizationName?: string;
  sourceVendorName?: string;
  priceCoverageDeclared?: boolean;
  transportIncluded?: boolean;
  loadingIncluded?: boolean;
  unloadingIncluded?: boolean;
  deliveredToProject?: boolean;
  /**
   * BP-REGION-TRUTH-07S §8 — "yes, this source scope is this Wilayah."
   *
   * An INTENT, not a region: the server pairs it with the Wilayah the batch
   * actually holds when the save lands, so a form cannot confirm a scope
   * against a place it is not saving. Never sent by the metadata form itself —
   * only by the explicit review action.
   */
  confirmRegionScopeCompatibility?: boolean;
}

/**
 * USI-01 §17 — an intake refusal, carried whole.
 *
 * The backend answers a refused upload with a NAMED code plus the evidence a
 * human needs to act on it: which tables it examined, which jurisdictions it
 * found, which structures were plausible. Collapsing that into a generic
 * "upload failed" is what produced the old message that blamed the user's
 * workbook for SIMPROK's own limits, so the whole body is kept.
 */
/** A column SIMPROK can describe but will not name on the human's behalf. */
export interface ColumnRoleCandidate {
  columnNumber: number;
  headerText: string | null;
  nonEmptyRows: number;
  distinctValues: number;
  samples: string[];
}

export interface IntakeRefusalDetails {
  choices?: string[];
  availableTables?: string[];
  availableStructures?: PriceTableStructure[];
  acceptedSections?: ResourceType[];
  supportedExtensions?: string[];
  tables?: { tableName: string; structures: PriceTableStructure[] }[];
  nameCandidates?: ColumnRoleCandidate[];
  unitCandidates?: ColumnRoleCandidate[];
  [key: string]: unknown;
}

export class IntakeRefusalError extends Error {
  // Explicit fields rather than constructor parameter properties: this project
  // builds with `erasableSyntaxOnly`, which forbids the shorthand.
  readonly code: string;
  readonly details: IntakeRefusalDetails;
  readonly httpStatus: number;

  constructor(code: string, details: IntakeRefusalDetails, httpStatus: number) {
    super(code);
    this.name = 'IntakeRefusalError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

/**
 * A request that failed for a reason having NOTHING to do with the workbook.
 *
 * Its own type, so the page can say which of them it was: a denied permission,
 * an expired session and a server fault are three different things a person
 * acts on differently, and none of them is a question about a file.
 */
export class ImportRequestError extends Error {
  readonly httpStatus: number;
  /** The server's own text, kept for diagnostics. Never rendered as prose. */
  readonly detail: string;

  constructor(httpStatus: number, detail: string) {
    super(`IMPORT_REQUEST_FAILED_${httpStatus}`);
    this.name = 'ImportRequestError';
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

async function parseOrThrow(response: Response): Promise<BasicPriceImportBatchSummary> {
  if (!response.ok) {
    const raw = await response.text();
    let body: ({ message?: unknown } & IntakeRefusalDetails) | null;
    try {
      body = JSON.parse(raw) as { message?: unknown } & IntakeRefusalDetails;
    } catch {
      body = null; // Not JSON — the raw text below is still more honest than a guess.
    }
    // A validation failure sends `message` as an ARRAY; a named intake refusal
    // sends one of the codes above. ANYTHING ELSE — a guard, a framework fault,
    // a message this client has never heard of — is not intake speaking, and is
    // never dressed up as a question about the document.
    if (body && typeof body.message === 'string' && isIntakeRefusalCode(body.message)) {
      throw new IntakeRefusalError(body.message, body, response.status);
    }
    throw new ImportRequestError(response.status, raw);
  }
  return response.json() as Promise<BasicPriceImportBatchSummary>;
}

export const buildResourceLookupPath = (query: ResourceLookupQuery) => buildLookupPath('resources', query);
export const buildUnitLookupPath = (query: UnitLookupQuery) => buildLookupPath('units', query);

export async function searchResourceCatalog(
  query: ResourceLookupQuery,
  signal?: AbortSignal,
): Promise<LookupPage<ResourceLookupItem>> {
  const response = await apiFetch(buildResourceLookupPath(query), { signal });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LookupPage<ResourceLookupItem>>;
}

export async function searchUnitDefinitions(
  query: UnitLookupQuery,
  signal?: AbortSignal,
): Promise<LookupPage<UnitLookupItem>> {
  const response = await apiFetch(buildUnitLookupPath(query), { signal });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LookupPage<UnitLookupItem>>;
}

const appendMetadata = (body: FormData, metadata: BasicPriceImportMetadata) => {
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null && value !== '') body.append(key, String(value));
  }
};

/**
 * USI-01 §5 — the answers to the questions SIMPROK asks ONCE, and only when the
 * source genuinely does not prove one reading. Every field is optional: a
 * source that proves exactly one reading is never interrogated.
 */
export interface BasicPriceIntakeSelection {
  /** Which table/sheet. NEVER pre-filled — §18 forbids requiring an exact name. */
  selectedSheet?: string;
  selectedStructure?: PriceTableStructure;
  /** The source's OWN jurisdiction wording, e.g. "SIRIMAU". Not a Region id. */
  selectedRegionLabel?: string;
  /** Stated by a human when the source declares no sections of its own. */
  declaredSection?: ResourceType;
  /** For a source whose name/unit columns carry no header at all. */
  selectedNameColumn?: number;
  selectedUnitColumn?: number;
  /** BP-KDN-01 — confirm an ambiguous KDN-like column. Never required. */
  selectedKdnColumn?: number;
}

export async function previewBasicPriceImport(
  file: File,
  selection: BasicPriceIntakeSelection,
  metadata: BasicPriceImportMetadata,
): Promise<BasicPriceImportBatchSummary> {
  const body = new FormData();
  body.append('file', file);
  for (const [key, value] of Object.entries(selection)) {
    if (value !== undefined && value !== null && value !== '') body.append(key, String(value));
  }
  appendMetadata(body, metadata);
  const response = await apiFetch('/basic-price-imports/preview', { method: 'POST', body });
  return parseOrThrow(response);
}

export async function getBasicPriceImportBatch(batchId: string): Promise<BasicPriceImportBatchSummary> {
  const response = await apiFetch(`/basic-price-imports/${batchId}`);
  return parseOrThrow(response);
}

export async function updateBasicPriceImportBatch(
  batchId: string,
  version: number,
  metadata: BasicPriceImportMetadata,
): Promise<BasicPriceImportBatchSummary> {
  const response = await apiFetch(`/basic-price-imports/${batchId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, ...metadata }),
  });
  return parseOrThrow(response);
}

export async function resolveBasicPriceImportRow(
  batchId: string,
  rowId: string,
  version: number,
  resourceCatalogId: string,
  unitDefinitionId: string,
): Promise<void> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/rows/${rowId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, resourceCatalogId, unitDefinitionId }),
  });
  // `ImportRequestError`, not a bare `Error`: it carries the status and body the
  // page needs to say WHY. A plain Error forced the caller to guess, and the
  // guess it printed was always "the row may have changed" — which is one of
  // several possible causes and the wrong one for a 401, 403 or 500.
  if (!response.ok) throw new ImportRequestError(response.status, await response.text());
}

export async function rejectBasicPriceImportRow(
  batchId: string,
  rowId: string,
  version: number,
  reason: string,
): Promise<void> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/rows/${rowId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, reason }),
  });
  if (!response.ok) throw new ImportRequestError(response.status, await response.text());
}

/**
 * RM-03D1 — existing admit-resource writer. The body must not name the
 * resource: name, type, and source code come from the import row. The reviewer
 * supplies only the canonical unit and the reason they are creating rather
 * than choosing.
 */
export async function admitResourceForImportRow(
  batchId: string,
  rowId: string,
  version: number,
  unitDefinitionId: string,
  reason: string,
): Promise<void> {
  const response = await apiFetch(
    `/basic-price-imports/${batchId}/rows/${rowId}/admit-resource`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, unitDefinitionId, reason }),
    },
  );
  if (!response.ok) throw new ImportRequestError(response.status, await response.text());
}

export async function submitBasicPriceImportBatch(batchId: string): Promise<BasicPriceImportBatchSummary> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/submit`, { method: 'POST' });
  return parseOrThrow(response);
}

/**
 * One price this workspace may now use, exactly as the server's
 * `mapPrivateBasicPriceItem` projection describes it. Mirrored, never
 * reshaped — a client that renames the server's fields is the first step
 * towards a client that reinterprets them.
 */
export interface PrivateBasicPriceItem {
  basicPriceId: string;
  resource: { id: string; code: string | null; name: string; type: string };
  region: { id: string; code: string; name: string } | null;
  /** Exact decimal string, two digits. Never a JS number. */
  price: string;
  effectiveDate: string;
  assetScope: 'WORKSPACE_PRIVATE';
  sourceOrigin: string;
  /** Publication axes, echoed so a caller can see they were NOT touched. */
  status: string;
  verificationStatus: string;
  sourceImportRowId: string;
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

export interface KeepBatchPrivateResult {
  batchId: string;
  createdCount: number;
  alreadyPrivateCount: number;
  prices: PrivateBasicPriceItem[];
}

export interface EnrichBasicPriceKdnResult {
  basicPriceId: string;
  kdnPercent: string;
  unchanged: boolean;
}

/**
 * BP-DETAIL-CHANGE-01 / BP-KDN-01 — fill a previously unknown %KDN on an
 * existing private price. Same `POST /basic-price-imports/prices/:priceId/kdn`
 * the review path already has. Does not mint a Basic Price and does not
 * touch money. Catalog / foreign-workspace rows fail closed as 404.
 */
export async function enrichBasicPriceKdn(
  priceId: string,
  kdnPercent: string,
  reason: string,
  expectedKdnPercent?: string | null,
): Promise<EnrichBasicPriceKdnResult> {
  const response = await apiFetch(`/basic-price-imports/prices/${priceId}/kdn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kdnPercent,
      reason,
      ...(expectedKdnPercent !== undefined ? { expectedKdnPercent } : {}),
    }),
  });
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<EnrichBasicPriceKdnResult>;
}

export interface SubmitPrivatePriceResult {
  basicPriceId: string;
  submissionId: string;
  alreadyProposed: boolean;
  status: string;
  assetScope: string;
}

/**
 * Same BASIC_PRICE_SUBMIT / PriceSubmission writer as batch Usulkan.
 * Does not publish. Does not convert the private price into catalog truth.
 */
export async function submitPrivateBasicPrice(
  priceId: string,
): Promise<SubmitPrivatePriceResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/submit`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<SubmitPrivatePriceResult>;
}

export async function enrichCatalogBasicPriceKdn(
  priceId: string,
  kdnPercent: string,
  reason: string,
  expectedKdnPercent?: string | null,
): Promise<EnrichBasicPriceKdnResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/catalog-kdn`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kdnPercent,
        reason,
        ...(expectedKdnPercent !== undefined ? { expectedKdnPercent } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<EnrichBasicPriceKdnResult>;
}

export interface CorrectPrivateBasicPriceResult {
  basicPriceId: string;
  value: string;
  unchanged: boolean;
}

export async function correctPrivateBasicPrice(
  priceId: string,
  expectedValue: string,
  proposedValue: string,
  reason: string,
): Promise<CorrectPrivateBasicPriceResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/corrections`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedValue, proposedValue, reason }),
    },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<CorrectPrivateBasicPriceResult>;
}

export async function observePrivateBasicPrice(
  priceId: string,
  expectedValue: string,
  proposedValue: string,
  effectiveDate: string,
  reason: string,
  evidence?: { sameSource?: boolean; sourceIdentityName?: string },
): Promise<CorrectPrivateBasicPriceResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/observations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedValue,
        proposedValue,
        effectiveDate,
        reason,
        ...(evidence?.sameSource === undefined
          ? {}
          : { sameSource: evidence.sameSource }),
        ...(evidence?.sourceIdentityName
          ? { sourceIdentityName: evidence.sourceIdentityName }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<CorrectPrivateBasicPriceResult>;
}

export async function observePrivateKdn(
  priceId: string,
  expectedValue: string,
  expectedKdnPercent: string,
  proposedKdnPercent: string,
  effectiveDate: string,
  reason: string,
): Promise<CorrectPrivateBasicPriceResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/kdn-observations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedValue,
        expectedKdnPercent,
        proposedKdnPercent,
        effectiveDate,
        reason,
      }),
    },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<CorrectPrivateBasicPriceResult>;
}

export async function correctPrivateKdn(
  priceId: string,
  expectedValue: string,
  expectedKdnPercent: string,
  proposedKdnPercent: string,
  reason: string,
): Promise<CorrectPrivateBasicPriceResult> {
  const response = await apiFetch(
    `/basic-price-imports/prices/${priceId}/kdn-corrections`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedValue,
        expectedKdnPercent,
        proposedKdnPercent,
        reason,
      }),
    },
  );
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<CorrectPrivateBasicPriceResult>;
}

/**
 * RM-03C — KEEP MY OWN RESOLVED ROWS, AND USE THEM.
 *
 * The route has existed since RM-03C and nothing in this app had ever called
 * it. So the only door out of the review room was `/submit`, which hands rows
 * to SIMPROK's curation queue and creates no usable price at all: a person who
 * simply wanted their own imported prices had no action that did that.
 *
 * Incremental and idempotent. It materializes whatever rows are finished now,
 * leaves the batch open so the rest can still be worked on, and a second call
 * over unchanged rows creates nothing and truthfully reports zero.
 *
 * A failure surfaces as `ImportRequestError` carrying the server's own named
 * code. It is deliberately NOT routed through `parseOrThrow`: that function
 * exists to recognise INTAKE refusals — questions about a document — and this
 * call is not about a document at all.
 */
export async function keepBasicPriceImportBatchPrivate(
  batchId: string,
): Promise<KeepBatchPrivateResult> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/keep-private`, { method: 'POST' });
  if (!response.ok) {
    throw new ImportRequestError(response.status, await response.text());
  }
  return response.json() as Promise<KeepBatchPrivateResult>;
}

/**
 * "Simpan & Gunakan" — ONE user intent, ONE request, ONE backend command.
 *
 * NOTE WHAT IS NOT IN THIS SIGNATURE: no resource id, no unit id, no list of
 * bindings. The browser states INTENT — "accept what you can prove, except
 * these rows I am still working on" — and the server derives the eligible set
 * from its own authorities at execution time. A client-authored list would be
 * stale by the time it arrived and would make this page the identity authority.
 *
 * IT IS ALSO ONE REQUEST, AND THAT MATTERS TWICE. The page once looped the
 * single-row resolve call per proven row — thirteen requests for the Owner's
 * workbook and an unusable product at a few thousand. It then made two: accept,
 * then keep. Two business mutations sequenced by a browser means a dropped
 * connection between them leaves the batch half-done with nobody able to say
 * which half. The orchestration is the server's now.
 */
export interface SmartSaveResult {
  batchId: string;
  accepted: {
    acceptedCount: number;
    eligibleCount: number;
    skippedCount: number;
    excludedCount: number;
    /** Eligible rows a work ceiling deferred. Press again; nothing is redone. */
    remainingEligible: number;
  };
  kept: KeepBatchPrivateResult;
}

export async function smartSaveBatch(
  batchId: string,
  excludeRowIds: string[] = [],
): Promise<SmartSaveResult> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/smart-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excludeRowIds }),
  });
  if (!response.ok) throw new ImportRequestError(response.status, await response.text());
  return (await response.json()) as SmartSaveResult;
}

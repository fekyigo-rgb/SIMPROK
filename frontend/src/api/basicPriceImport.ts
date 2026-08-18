// Thin wrapper around the shared apiFetch() for the RM-02 Basic Price
// import endpoints. Not a new HTTP mechanism — same fetch/apiFetch client
// as the rest of the app, just grouped by resource instead of inlined into
// a page (the pages are large enough on their own already).
import { apiFetch } from '../utils/apiClient';
import type { BasicPriceImportBatchSummary } from '../utils/basicPriceImportDisplay';
import { buildLookupPath } from '../utils/catalogSearch';

export type PriceSourceType = 'VENDOR_QUOTE' | 'MARKET_SURVEY' | 'REGULATION' | 'SYSTEM_ESTIMATE';
export type PriceSourceOrigin = 'GOVERNMENT' | 'SUPPLIER' | 'STORE' | 'DISTRIBUTOR' | 'FIELD_REPORT' | 'COMMUNITY_REPORT';
export type ResourceType = 'MATERIAL' | 'LABOR' | 'EQUIPMENT';
export type PriceTableStructure = 'SECTIONED_PRICE_LIST' | 'SEMANTIC_HEADER_TABLE' | 'REGIONAL_MATRIX';
export type UnitDimension = 'COUNT' | 'MASS' | 'LENGTH' | 'AREA' | 'VOLUME' | 'TIME' | 'PERSON_TIME' | 'EQUIPMENT_TIME';
export type UnitKind = 'CANONICAL' | 'COMMERCIAL_PACKAGE' | 'CONTEXTUAL';

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
  sourceType?: PriceSourceType;
  sourceOrigin?: PriceSourceOrigin;
  sourceOrganizationName?: string;
  sourceVendorName?: string;
  priceCoverageDeclared?: boolean;
  transportIncluded?: boolean;
  loadingIncluded?: boolean;
  unloadingIncluded?: boolean;
  deliveredToProject?: boolean;
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

async function parseOrThrow(response: Response): Promise<BasicPriceImportBatchSummary> {
  if (!response.ok) {
    const raw = await response.text();
    let body: ({ message?: unknown } & IntakeRefusalDetails) | null = null;
    try {
      body = JSON.parse(raw) as { message?: unknown } & IntakeRefusalDetails;
    } catch {
      body = null; // Not JSON — the raw text below is still more honest than a guess.
    }
    // A validation failure sends `message` as an ARRAY; only a named intake
    // refusal sends it as a single code.
    if (body && typeof body.message === 'string') {
      throw new IntakeRefusalError(body.message, body, response.status);
    }
    throw new Error(raw);
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
  if (!response.ok) throw new Error(await response.text());
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
  if (!response.ok) throw new Error(await response.text());
}

export async function submitBasicPriceImportBatch(batchId: string): Promise<BasicPriceImportBatchSummary> {
  const response = await apiFetch(`/basic-price-imports/${batchId}/submit`, { method: 'POST' });
  return parseOrThrow(response);
}

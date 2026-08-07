import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Prisma, type PrismaClient, type ResourceType } from '@prisma/client';

/**
 * RM-02C1b — Reviewed Resource Catalog Bootstrap.
 *
 * Pure planning + transactional apply for the one-time, human-reviewed
 * bootstrap of Workspace-A's ResourceCatalog from the already-locked RM-02C0
 * canonical inventory. Every special-case row below is an explicit,
 * enumerated source row number from the governing contract — never a
 * pattern-matching or fuzzy-merge algorithm. AUTO_FUZZY_MERGE,
 * AUTO_GENERATED_CANONICAL_CODE, and AUTO_UNIT_CONVERSION are all forbidden;
 * nothing here infers an identity that wasn't explicitly authorized.
 *
 * This module has no database-name guard of its own by design — that lives
 * in scripts/rm02c1b/resource-catalog-bootstrap.ts (the only sanctioned
 * entry point against a real environment). This module operates on whatever
 * Prisma client it is given, which is what lets the disposable-instance
 * proof and the real simprok_test apply share one code path.
 */

// ============================================================
// LOCKED CONSTANTS (RM-02C0 canonical evidence + RM-02C1b contract)
// ============================================================

export const PLAN_CONTRACT_VERSION = 'RM02C1B_BOOTSTRAP_PLAN_V1';

/**
 * The legacy RM-02C1b acceptance token. Its literal text names simprok_test,
 * and that is exactly right for what it authorizes. It remains the DEFAULT
 * expectation of applyBootstrapPlan, so every pre-RM-03D0 caller — the
 * acceptance CLI wrapper, the unit spec and the acceptance E2E — keeps its
 * behaviour byte-for-byte, including rejecting any other string.
 */
export const CONFIRMATION_TOKEN = 'APPLY_RM02C1B_TO_SIMPROK_TEST';

/**
 * RM-03D0 — the canonical-reference token.
 *
 * WHY THIS EXISTS. The planning, identity, disposition and provenance law in
 * this module is target-agnostic by design, and RM-03D0 reuses it verbatim
 * against canonical `simprok_db`. What was NOT target-agnostic was the apply
 * gate: it demanded a token whose meaning is "apply to simprok_test". Passing
 * that string while writing to canonical would have made the audit trail say
 * something untrue, so the coupling is removed rather than worked around.
 *
 * This is ADDITIVE ONLY. No planning behaviour changes, no default is
 * loosened, and the two authorities can never substitute for one another:
 * each caller must name the token it expects, and the supplied token must
 * equal that exact expectation.
 */
export const CANONICAL_REFERENCE_CONFIRMATION_TOKEN =
  'APPLY_RM03D0_CANONICAL_REFERENCES';

/**
 * The closed set of confirmation authorities this module recognises.
 *
 * A caller may only ever *select* one of these; it can never invent a token
 * pair of its own. Without this allow-list, `expectedConfirmationToken` would
 * be a footgun: a caller could pass the same arbitrary string as both the
 * expectation and the supplied token and the gate would degrade into a
 * tautology. Membership is checked before equality, so an unknown expectation
 * fails closed even when the two strings match.
 */
export const KNOWN_CONFIRMATION_TOKENS: readonly string[] = [
  CONFIRMATION_TOKEN,
  CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
];

export const EXPECTED_SOURCE_SHA256 =
  '46B3F354A74A10BDB26316802D922B7D6C34AA109579FA55A3A9EA5D61504B61';
export const EXPECTED_PARSER_CONTRACT_VERSION = 'RM02_BASIC_PRICE_01_V1';
export const EXPECTED_SHEET_NAME = 'HARGA SATUAN UPAH DAN BAHAN';
export const EXPECTED_TOTAL_SOURCE_ROWS = 271;
export const EXPECTED_SECTION_COUNTS: Record<string, number> = {
  LABOR: 17,
  MATERIAL: 241,
  EQUIPMENT: 13,
};

/** Row 9 is the only source row human-verified as canonical in this slice. */
const CANONICAL_CODE_ROW = 9;
const CANONICAL_CODE_VALUE = 'L.01';
const CANONICAL_CODE_NAME = 'Pekerja';
const CANONICAL_CODE_TYPE: ResourceType = 'LABOR';
const CANONICAL_CODE_UNIT = 'Org/Hari';

/** Rows with a genuinely empty source unit cell — blocked, zero writes. */
const BLOCKED_MISSING_UNIT_ROWS = new Set<number>([39, 104]);

/**
 * The only two source-row pairs authorized to collapse into one
 * ResourceCatalog (exact byte-identical section+name+unit). No generic
 * duplicate-detection algorithm is used — this list is the entire authority.
 */
const EXACT_DUPLICATE_GROUPS: ReadonlyArray<{
  representative: number;
  duplicate: number;
}> = [
  { representative: 136, duplicate: 137 },
  { representative: 157, duplicate: 161 },
];

/** Same name, different unit — must remain distinct resources (label only). */
const SAME_NAME_DIFFERENT_UNIT_ROWS = new Set<number>([200, 201]);

// ============================================================
// INVENTORY TYPES
// ============================================================

export interface InventoryRow {
  sourceRowNumber: number;
  sourceSection: ResourceType;
  rawResourceCodeText: string | null;
  rawResourceNameText: string;
  rawUnitText: string | null;
  sourceCodeCellAddress: string | null;
  sourceNameCellAddress: string;
  sourceUnitCellAddress: string | null;
  warnings: string[];
  errors: string[];
}

export interface CanonicalInventory {
  parserContractVersion: string;
  sourceFileName: string;
  sourceSha256: string;
  sheetName: string;
  totalParsedRows: number;
  sectionCounts: Record<string, number>;
  rows: InventoryRow[];
}

export class InventoryVerificationError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'InventoryVerificationError';
  }
}

/**
 * Loads and verifies the committed RM-02C0 inventory against every pinned
 * expectation. Throws InventoryVerificationError (never returns a partially
 * trusted inventory) on any mismatch — a tampered file, a wrong source hash,
 * a wrong parser contract, or a row/section count drift all fail closed.
 */
export function loadCanonicalInventory(
  inventoryPath: string,
  expectedInventorySha256: string,
): { inventory: CanonicalInventory; inventorySha256: string } {
  const raw = readFileSync(inventoryPath, 'utf8');
  const inventorySha256 = createHash('sha256')
    .update(raw)
    .digest('hex')
    .toUpperCase();

  if (inventorySha256 !== expectedInventorySha256.toUpperCase()) {
    throw new InventoryVerificationError(
      'STOP_INVENTORY_HASH_MISMATCH',
      `Inventory file byte hash ${inventorySha256} does not match the expected pinned hash ${expectedInventorySha256}. The committed evidence file must never be edited or replaced.`,
    );
  }

  const inventory = JSON.parse(raw) as CanonicalInventory;

  if (inventory.sourceSha256.toUpperCase() !== EXPECTED_SOURCE_SHA256.toUpperCase()) {
    throw new InventoryVerificationError(
      'STOP_SOURCE_HASH_MISMATCH',
      `Inventory sourceSha256 ${inventory.sourceSha256} does not match the expected canonical source workbook hash ${EXPECTED_SOURCE_SHA256}.`,
    );
  }
  if (inventory.parserContractVersion !== EXPECTED_PARSER_CONTRACT_VERSION) {
    throw new InventoryVerificationError(
      'STOP_PARSER_CONTRACT_MISMATCH',
      `Inventory parserContractVersion "${inventory.parserContractVersion}" does not match expected "${EXPECTED_PARSER_CONTRACT_VERSION}".`,
    );
  }
  if (inventory.sheetName !== EXPECTED_SHEET_NAME) {
    throw new InventoryVerificationError(
      'STOP_SHEET_NAME_MISMATCH',
      `Inventory sheetName "${inventory.sheetName}" does not match expected "${EXPECTED_SHEET_NAME}".`,
    );
  }
  if (inventory.totalParsedRows !== EXPECTED_TOTAL_SOURCE_ROWS || inventory.rows.length !== EXPECTED_TOTAL_SOURCE_ROWS) {
    throw new InventoryVerificationError(
      'STOP_ROW_COUNT_MISMATCH',
      `Inventory totalParsedRows/rows.length must be exactly ${EXPECTED_TOTAL_SOURCE_ROWS}; got totalParsedRows=${inventory.totalParsedRows}, rows.length=${inventory.rows.length}.`,
    );
  }
  for (const section of Object.keys(EXPECTED_SECTION_COUNTS)) {
    if (inventory.sectionCounts[section] !== EXPECTED_SECTION_COUNTS[section]) {
      throw new InventoryVerificationError(
        'STOP_SECTION_COUNT_MISMATCH',
        `Inventory sectionCounts.${section} = ${inventory.sectionCounts[section]}, expected ${EXPECTED_SECTION_COUNTS[section]}.`,
      );
    }
  }

  return { inventory, inventorySha256 };
}

// ============================================================
// PLAN TYPES
// ============================================================

export type BootstrapDisposition =
  | 'CREATE_NEW_RESOURCE'
  | 'REUSE_EXACT_L01'
  | 'CREATE_L01_IF_ABSENT'
  | 'ATTACH_EXACT_DUPLICATE_PROVENANCE'
  | 'CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT'
  | 'BLOCKED_MISSING_SOURCE_UNIT'
  | 'IDEMPOTENT_ALREADY_APPLIED'
  | 'CONFLICT_STOP';

export const ALL_DISPOSITIONS: readonly BootstrapDisposition[] = [
  'CREATE_NEW_RESOURCE',
  'REUSE_EXACT_L01',
  'CREATE_L01_IF_ABSENT',
  'ATTACH_EXACT_DUPLICATE_PROVENANCE',
  'CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT',
  'BLOCKED_MISSING_SOURCE_UNIT',
  'IDEMPOTENT_ALREADY_APPLIED',
  'CONFLICT_STOP',
];

export interface BootstrapPlanEntry {
  sourceRowNumber: number;
  sourceSection: ResourceType;
  rawResourceCodeText: string | null;
  rawResourceNameText: string;
  rawUnitText: string | null;
  sourceCodeCellAddress: string | null;
  sourceNameCellAddress: string;
  sourceUnitCellAddress: string | null;
  disposition: BootstrapDisposition;
  canonicalCode: string | null;
  representativeSourceRowNumber: number;
  conflictReason: string | null;
}

export interface BootstrapPlan {
  planContractVersion: string;
  inventoryPath: string;
  inventorySha256: string;
  sourceSha256: string;
  parserContractVersion: string;
  sheetName: string;
  workspaceId: string;
  generatedFromGitHead: string;
  sourceRowsTotal: number;
  dispositionCounts: Record<BootstrapDisposition, number>;
  entries: BootstrapPlanEntry[];
}

// ============================================================
// EXISTING-STATE READ (read-only; used by both plan and apply)
// ============================================================

type QueryClient = PrismaClient | Prisma.TransactionClient;

interface ExistingCatalogRow {
  id: string;
  workspaceId: string | null;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  specifications: Prisma.JsonValue | null;
}

interface ExistingProvenanceRow {
  id: string;
  resourceCatalogId: string;
  rawCode: string | null;
  rawName: string;
  rawUnit: string | null;
  sourceCodeCellAddress: string | null;
  sourceNameCellAddress: string;
  sourceUnitCellAddress: string | null;
}

export interface ExistingState {
  catalogById: Map<string, ExistingCatalogRow>;
  provenanceByRowNumber: Map<number, ExistingProvenanceRow>;
}

/**
 * Scope note: this snapshot is read once, before the row loop, and is never
 * updated as sibling rows are planned within the same buildPlan() call. The
 * STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION check therefore only catches a
 * collision against a resource that predates this plan — not two sibling
 * source rows that happen to share name+type+unit without being one of the
 * explicitly authorized EXACT_DUPLICATE_GROUPS pairs. This is provably moot
 * for the locked 271-row RM-02C0 inventory (its anomaly register's
 * duplicateExactIdentityGroupCount is exhaustively 2, matching those two
 * hardcoded pairs exactly), but would need extending — folding newly-planned
 * identities into this set as rows are processed — before this planner is
 * reused against any different or revised inventory.
 */
async function loadExistingState(
  client: QueryClient,
  workspaceId: string,
  sourceSha256: string,
  sheetName: string,
  parserContractVersion: string,
): Promise<ExistingState> {
  const [catalogRows, provenanceRows] = await Promise.all([
    client.resourceCatalog.findMany({ where: { workspaceId } }),
    client.resourceSourceIdentity.findMany({
      where: { workspaceId, sourceSha256, sheetName, parserContractVersion },
    }),
  ]);

  const catalogById = new Map<string, ExistingCatalogRow>();
  for (const row of catalogRows) {
    catalogById.set(row.id, {
      id: row.id,
      workspaceId: row.workspaceId,
      code: row.code,
      name: row.name,
      type: row.type,
      baseUnit: row.baseUnit,
      specifications: row.specifications,
    });
  }

  const provenanceByRowNumber = new Map<number, ExistingProvenanceRow>();
  for (const row of provenanceRows) {
    provenanceByRowNumber.set(row.sourceRowNumber, {
      id: row.id,
      resourceCatalogId: row.resourceCatalogId,
      rawCode: row.rawCode,
      rawName: row.rawName,
      rawUnit: row.rawUnit,
      sourceCodeCellAddress: row.sourceCodeCellAddress,
      sourceNameCellAddress: row.sourceNameCellAddress,
      sourceUnitCellAddress: row.sourceUnitCellAddress,
    });
  }

  return { catalogById, provenanceByRowNumber };
}

function representativeRowNumberFor(sourceRowNumber: number): number {
  const group = EXACT_DUPLICATE_GROUPS.find((g) => g.duplicate === sourceRowNumber);
  return group ? group.representative : sourceRowNumber;
}

function isDuplicateAttachRow(sourceRowNumber: number): boolean {
  return EXACT_DUPLICATE_GROUPS.some((g) => g.duplicate === sourceRowNumber);
}

function expectedCanonicalCodeFor(sourceRowNumber: number): string | null {
  return sourceRowNumber === CANONICAL_CODE_ROW ? CANONICAL_CODE_VALUE : null;
}

function catalogMatchesRowExpectation(
  catalog: ExistingCatalogRow,
  row: InventoryRow,
  workspaceId: string,
): boolean {
  const expectedName = row.sourceRowNumber === CANONICAL_CODE_ROW ? CANONICAL_CODE_NAME : row.rawResourceNameText;
  const expectedType = row.sourceRowNumber === CANONICAL_CODE_ROW ? CANONICAL_CODE_TYPE : row.sourceSection;
  const expectedUnit = row.sourceRowNumber === CANONICAL_CODE_ROW ? CANONICAL_CODE_UNIT : row.rawUnitText;
  return (
    catalog.workspaceId === workspaceId &&
    catalog.name === expectedName &&
    catalog.type === expectedType &&
    catalog.baseUnit === expectedUnit &&
    catalog.code === expectedCanonicalCodeFor(row.sourceRowNumber)
  );
}

function provenanceRawMatchesRow(existing: ExistingProvenanceRow, row: InventoryRow): boolean {
  return (
    existing.rawCode === row.rawResourceCodeText &&
    existing.rawName === row.rawResourceNameText &&
    existing.rawUnit === row.rawUnitText &&
    existing.sourceCodeCellAddress === row.sourceCodeCellAddress &&
    existing.sourceNameCellAddress === row.sourceNameCellAddress &&
    existing.sourceUnitCellAddress === row.sourceUnitCellAddress
  );
}

// ============================================================
// PER-ROW DISPOSITION
// ============================================================

function computeEntryForRow(
  row: InventoryRow,
  existing: ExistingState,
  workspaceId: string,
): BootstrapPlanEntry {
  const base = {
    sourceRowNumber: row.sourceRowNumber,
    sourceSection: row.sourceSection,
    rawResourceCodeText: row.rawResourceCodeText,
    rawResourceNameText: row.rawResourceNameText,
    rawUnitText: row.rawUnitText,
    sourceCodeCellAddress: row.sourceCodeCellAddress,
    sourceNameCellAddress: row.sourceNameCellAddress,
    sourceUnitCellAddress: row.sourceUnitCellAddress,
  };
  const representativeSourceRowNumber = representativeRowNumberFor(row.sourceRowNumber);

  // F. Blocked — highest priority, zero writes, no further evaluation.
  if (BLOCKED_MISSING_UNIT_ROWS.has(row.sourceRowNumber)) {
    return {
      ...base,
      disposition: 'BLOCKED_MISSING_SOURCE_UNIT',
      canonicalCode: null,
      representativeSourceRowNumber,
      conflictReason:
        'Source unit cell is empty (BLOCKED_MISSING_SOURCE_UNIT); human disposition deferred to RM-02C1c.',
    };
  }

  const existingProvenance = existing.provenanceByRowNumber.get(row.sourceRowNumber);

  if (existingProvenance) {
    if (!provenanceRawMatchesRow(existingProvenance, row)) {
      return {
        ...base,
        disposition: 'CONFLICT_STOP',
        canonicalCode: expectedCanonicalCodeFor(row.sourceRowNumber),
        representativeSourceRowNumber,
        conflictReason: `Existing ResourceSourceIdentity for source row ${row.sourceRowNumber} does not match the committed inventory's raw fields exactly.`,
      };
    }
    const linkedCatalog = existing.catalogById.get(existingProvenance.resourceCatalogId);
    if (!linkedCatalog || !catalogMatchesRowExpectation(linkedCatalog, row, workspaceId)) {
      return {
        ...base,
        disposition: 'CONFLICT_STOP',
        canonicalCode: expectedCanonicalCodeFor(row.sourceRowNumber),
        representativeSourceRowNumber,
        conflictReason: `Existing provenance for source row ${row.sourceRowNumber} links to a ResourceCatalog that no longer exists or no longer matches the expected identity.`,
      };
    }
    return {
      ...base,
      disposition: 'IDEMPOTENT_ALREADY_APPLIED',
      canonicalCode: expectedCanonicalCodeFor(row.sourceRowNumber),
      representativeSourceRowNumber,
      conflictReason: null,
    };
  }

  // No existing provenance for this row yet.

  if (row.sourceRowNumber === CANONICAL_CODE_ROW) {
    const l01Like = [...existing.catalogById.values()].filter((c) => c.code === CANONICAL_CODE_VALUE);
    if (l01Like.length > 1) {
      return {
        ...base,
        disposition: 'CONFLICT_STOP',
        canonicalCode: CANONICAL_CODE_VALUE,
        representativeSourceRowNumber,
        conflictReason: `STOP_L01_CONFLICT: more than one ResourceCatalog with code=L.01 exists in Workspace-A.`,
      };
    }
    if (l01Like.length === 1) {
      const exact = catalogMatchesRowExpectation(l01Like[0], row, workspaceId);
      if (!exact) {
        return {
          ...base,
          disposition: 'CONFLICT_STOP',
          canonicalCode: CANONICAL_CODE_VALUE,
          representativeSourceRowNumber,
          conflictReason: `STOP_L01_CONFLICT: an existing code=L.01 resource does not exactly match name=Pekerja/type=LABOR/baseUnit=Org-Hari.`,
        };
      }
      return {
        ...base,
        disposition: 'REUSE_EXACT_L01',
        canonicalCode: CANONICAL_CODE_VALUE,
        representativeSourceRowNumber,
        conflictReason: null,
      };
    }
    return {
      ...base,
      disposition: 'CREATE_L01_IF_ABSENT',
      canonicalCode: CANONICAL_CODE_VALUE,
      representativeSourceRowNumber,
      conflictReason: null,
    };
  }

  if (isDuplicateAttachRow(row.sourceRowNumber)) {
    return {
      ...base,
      disposition: 'ATTACH_EXACT_DUPLICATE_PROVENANCE',
      canonicalCode: null,
      representativeSourceRowNumber,
      conflictReason: null,
    };
  }

  const unprovenCandidate = [...existing.catalogById.values()].find(
    (c) => c.name === row.rawResourceNameText && c.type === row.sourceSection && c.baseUnit === row.rawUnitText,
  );
  if (unprovenCandidate) {
    return {
      ...base,
      disposition: 'CONFLICT_STOP',
      canonicalCode: null,
      representativeSourceRowNumber,
      // Deliberately no database-generated UUID here (unprovenCandidate.id
      // is omitted) — the plan this feeds into must stay reproducible and
      // UUID-free across independent builds; name/type/unit already
      // identify the collision unambiguously for a human reader.
      conflictReason: `STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION: an existing ResourceCatalog already matches name="${unprovenCandidate.name}"/type=${unprovenCandidate.type}/baseUnit="${unprovenCandidate.baseUnit}" for source row ${row.sourceRowNumber} without matching provenance. Refusing to auto-merge.`,
    };
  }

  return {
    ...base,
    disposition: SAME_NAME_DIFFERENT_UNIT_ROWS.has(row.sourceRowNumber)
      ? 'CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT'
      : 'CREATE_NEW_RESOURCE',
    canonicalCode: null,
    representativeSourceRowNumber,
    conflictReason: null,
  };
}

// ============================================================
// PLAN BUILD + CANONICAL HASH
// ============================================================

export interface BuildPlanParams {
  inventory: CanonicalInventory;
  inventoryPath: string;
  inventorySha256: string;
  workspaceId: string;
  generatedFromGitHead: string;
}

export async function buildPlan(client: QueryClient, params: BuildPlanParams): Promise<BootstrapPlan> {
  const existing = await loadExistingState(
    client,
    params.workspaceId,
    params.inventory.sourceSha256,
    params.inventory.sheetName,
    params.inventory.parserContractVersion,
  );

  const entries = [...params.inventory.rows]
    .sort((a, b) => a.sourceRowNumber - b.sourceRowNumber)
    .map((row) => computeEntryForRow(row, existing, params.workspaceId));

  const dispositionCounts = Object.fromEntries(
    ALL_DISPOSITIONS.map((d) => [d, entries.filter((e) => e.disposition === d).length]),
  ) as Record<BootstrapDisposition, number>;

  return {
    planContractVersion: PLAN_CONTRACT_VERSION,
    inventoryPath: params.inventoryPath,
    inventorySha256: params.inventorySha256,
    sourceSha256: params.inventory.sourceSha256,
    parserContractVersion: params.inventory.parserContractVersion,
    sheetName: params.inventory.sheetName,
    workspaceId: params.workspaceId,
    generatedFromGitHead: params.generatedFromGitHead,
    sourceRowsTotal: params.inventory.totalParsedRows,
    dispositionCounts,
    entries,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalPlanJson(plan: BootstrapPlan): string {
  return JSON.stringify(canonicalize(plan), null, 2);
}

export function computePlanHash(plan: BootstrapPlan): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex').toUpperCase();
}

// ============================================================
// APPLY
// ============================================================

export interface ApplyParams {
  expectedPlanSha256: string;
  confirmationToken: string;
  /**
   * RM-03D0 — which confirmation authority this call is claiming.
   *
   * Omitted means the legacy RM-02C1b acceptance authority, so every
   * pre-RM-03D0 caller is unchanged and still fail-closed. A canonical caller
   * must name CANONICAL_REFERENCE_CONFIRMATION_TOKEN explicitly; there is no
   * permissive value, no default that widens anything, and no environment
   * sniffing inside this planning module.
   *
   * Must be a member of KNOWN_CONFIRMATION_TOKENS — an unrecognised
   * expectation is refused even if `confirmationToken` matches it.
   */
  expectedConfirmationToken?: string;
  workspaceId: string;
  inventory: CanonicalInventory;
  inventoryPath: string;
  inventorySha256: string;
  generatedFromGitHead: string;
  /**
   * Test-only seam to prove transactional atomicity: when set, apply throws
   * immediately after processing the given source row, before commit. Must
   * never be set by the CLI wrapper against a real environment.
   */
  injectFailureAfterSourceRowNumber?: number;
}

export interface ApplyResult {
  plan: BootstrapPlan;
  planSha256: string;
  resourceCatalogCreatedDelta: number;
  resourceCatalogReusedDelta: number;
  resourceCatalogUpdatedDelta: number;
  provenanceCreatedDelta: number;
}

function advisoryLockKey(workspaceId: string, sourceSha256: string, parserContractVersion: string): bigint {
  const digest = createHash('sha256')
    .update(`rm02c1b|${workspaceId}|${sourceSha256}|${parserContractVersion}`)
    .digest('hex');
  // First 60 bits: always non-negative, always fits Postgres bigint (63-bit
  // signed range) and JS BigInt exactly — no masking/overflow ambiguity.
  return BigInt(`0x${digest.slice(0, 15)}`);
}

export class BootstrapApplyError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'BootstrapApplyError';
  }
}

export async function applyBootstrapPlan(prisma: PrismaClient, params: ApplyParams): Promise<ApplyResult> {
  // RM-03D0: which authority is being claimed. Defaulting to the legacy
  // acceptance token keeps every pre-RM-03D0 caller identical — including its
  // rejection of any other string.
  const expectedConfirmationToken =
    params.expectedConfirmationToken ?? CONFIRMATION_TOKEN;

  // Membership first, equality second. An unrecognised expectation must fail
  // closed even when the caller supplies a matching string, otherwise the
  // gate would collapse into "any token equals itself".
  if (!KNOWN_CONFIRMATION_TOKENS.includes(expectedConfirmationToken)) {
    throw new BootstrapApplyError(
      'STOP_UNKNOWN_CONFIRMATION_AUTHORITY',
      'Refusing to apply: expectedConfirmationToken is not a recognised confirmation authority.',
    );
  }

  if (params.confirmationToken !== expectedConfirmationToken) {
    throw new BootstrapApplyError(
      'STOP_MISSING_CONFIRMATION_TOKEN',
      `Refusing to apply: confirmationToken must be exactly "${expectedConfirmationToken}".`,
    );
  }

  // Defense-in-depth: the CLI wrapper never sets this, by convention, but a
  // future caller doing so outside a test process must not be trusted on
  // convention alone. Both this repo's Jest unit and e2e runners already set
  // NODE_ENV=test (the same assumption as the explicit acceptance guard)
  // guard relies on), so this is a real, not cosmetic, runtime boundary.
  if (params.injectFailureAfterSourceRowNumber !== undefined && process.env.NODE_ENV !== 'test') {
    throw new BootstrapApplyError(
      'STOP_TEST_ONLY_PARAMETER_OUTSIDE_TEST',
      'injectFailureAfterSourceRowNumber was supplied outside a test process (NODE_ENV !== "test") — refusing to honor a test-only failure-injection seam against a real environment.',
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const lockKey = advisoryLockKey(
        params.workspaceId,
        params.inventory.sourceSha256,
        params.inventory.parserContractVersion,
      );
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      const plan = await buildPlan(tx, {
        inventory: params.inventory,
        inventoryPath: params.inventoryPath,
        inventorySha256: params.inventorySha256,
        workspaceId: params.workspaceId,
        generatedFromGitHead: params.generatedFromGitHead,
      });
      const planSha256 = computePlanHash(plan);

      if (planSha256 !== params.expectedPlanSha256.toUpperCase()) {
        throw new BootstrapApplyError(
          'STOP_STALE_PLAN_HASH',
          `Live plan hash ${planSha256} does not match the confirmed plan hash ${params.expectedPlanSha256}. The live database or inventory state has changed since the plan was reviewed — refusing to apply a stale confirmation.`,
        );
      }

      const conflicts = plan.entries.filter((e) => e.disposition === 'CONFLICT_STOP');
      if (conflicts.length > 0) {
        throw new BootstrapApplyError(
          'STOP_CONFLICTS_PRESENT',
          `Refusing to apply: ${conflicts.length} row(s) have disposition CONFLICT_STOP: ${conflicts.map((c) => `row ${c.sourceRowNumber} (${c.conflictReason})`).join('; ')}`,
        );
      }

      let resourceCatalogCreatedDelta = 0;
      let resourceCatalogReusedDelta = 0;
      let resourceCatalogUpdatedDelta = 0;
      let provenanceCreatedDelta = 0;

      const resolvedCatalogIdByRepresentativeRow = new Map<number, string>();

      // Sorted ascending by sourceRowNumber already (buildPlan sorts entries),
      // so every representative row is processed before its attach-row.
      for (const entry of plan.entries) {
        if (entry.disposition === 'BLOCKED_MISSING_SOURCE_UNIT' || entry.disposition === 'IDEMPOTENT_ALREADY_APPLIED') {
          if (entry.disposition === 'IDEMPOTENT_ALREADY_APPLIED') {
            const existingProvenance = await tx.resourceSourceIdentity.findFirstOrThrow({
              where: {
                workspaceId: params.workspaceId,
                sourceSha256: params.inventory.sourceSha256,
                sheetName: params.inventory.sheetName,
                parserContractVersion: params.inventory.parserContractVersion,
                sourceRowNumber: entry.sourceRowNumber,
              },
            });
            resolvedCatalogIdByRepresentativeRow.set(entry.sourceRowNumber, existingProvenance.resourceCatalogId);
          }
        } else if (entry.disposition === 'CREATE_L01_IF_ABSENT') {
          const catalog = await tx.resourceCatalog.create({
            data: {
              workspaceId: params.workspaceId,
              code: CANONICAL_CODE_VALUE,
              name: CANONICAL_CODE_NAME,
              type: CANONICAL_CODE_TYPE,
              baseUnit: CANONICAL_CODE_UNIT,
              status: 'ACTIVE',
            },
          });
          resourceCatalogCreatedDelta += 1;
          resolvedCatalogIdByRepresentativeRow.set(entry.sourceRowNumber, catalog.id);
          await tx.resourceSourceIdentity.create({
            data: buildProvenanceCreateData(params, entry, catalog.id),
          });
          provenanceCreatedDelta += 1;
        } else if (entry.disposition === 'REUSE_EXACT_L01') {
          const l01 = await tx.resourceCatalog.findFirstOrThrow({
            where: { workspaceId: params.workspaceId, code: CANONICAL_CODE_VALUE },
          });
          resolvedCatalogIdByRepresentativeRow.set(entry.sourceRowNumber, l01.id);
          const specifications = l01.specifications as Record<string, unknown> | null;
          if (specifications && Object.prototype.hasOwnProperty.call(specifications, 'rm02bTestOnly')) {
            const { rm02bTestOnly: _rm02bTestOnly, ...rest } = specifications;
            const nextSpecifications = Object.keys(rest).length > 0 ? rest : null;
            await tx.resourceCatalog.update({
              where: { id: l01.id },
              data: {
                specifications:
                  nextSpecifications === null ? Prisma.JsonNull : (nextSpecifications as Prisma.InputJsonObject),
              },
            });
            resourceCatalogUpdatedDelta += 1;
          }
          resourceCatalogReusedDelta += 1;
          await tx.resourceSourceIdentity.create({
            data: buildProvenanceCreateData(params, entry, l01.id),
          });
          provenanceCreatedDelta += 1;
        } else if (entry.disposition === 'ATTACH_EXACT_DUPLICATE_PROVENANCE') {
          const representativeCatalogId = resolvedCatalogIdByRepresentativeRow.get(entry.representativeSourceRowNumber);
          if (!representativeCatalogId) {
            throw new BootstrapApplyError(
              'STOP_REPRESENTATIVE_UNRESOLVED',
              `Row ${entry.sourceRowNumber}'s representative row ${entry.representativeSourceRowNumber} was not resolved before this row was processed.`,
            );
          }
          await tx.resourceSourceIdentity.create({
            data: buildProvenanceCreateData(params, entry, representativeCatalogId),
          });
          provenanceCreatedDelta += 1;
        } else if (entry.disposition === 'CREATE_NEW_RESOURCE' || entry.disposition === 'CREATE_DISTINCT_SAME_NAME_DIFFERENT_UNIT') {
          const catalog = await tx.resourceCatalog.create({
            data: {
              workspaceId: params.workspaceId,
              code: null,
              name: entry.rawResourceNameText,
              type: entry.sourceSection,
              baseUnit: entry.rawUnitText ?? '',
              status: 'ACTIVE',
            },
          });
          resourceCatalogCreatedDelta += 1;
          resolvedCatalogIdByRepresentativeRow.set(entry.sourceRowNumber, catalog.id);
          await tx.resourceSourceIdentity.create({
            data: buildProvenanceCreateData(params, entry, catalog.id),
          });
          provenanceCreatedDelta += 1;
        } else {
          // Exhaustive guard: every disposition value is handled above,
          // except CONFLICT_STOP, which the upfront gate (above this loop)
          // already refuses to reach here. If a future disposition value is
          // ever added without wiring its write behavior in, or if that
          // upfront gate is ever weakened, fail loudly here rather than
          // silently no-op mid-transaction.
          throw new BootstrapApplyError(
            'STOP_UNHANDLED_DISPOSITION',
            `Row ${entry.sourceRowNumber} has disposition "${entry.disposition}", which has no write behavior wired into applyBootstrapPlan. Refusing to silently no-op.`,
          );
        }

        if (params.injectFailureAfterSourceRowNumber === entry.sourceRowNumber) {
          throw new Error(`INJECTED_TEST_FAILURE_AFTER_ROW_${entry.sourceRowNumber}`);
        }
      }

      return {
        plan,
        planSha256,
        resourceCatalogCreatedDelta,
        resourceCatalogReusedDelta,
        resourceCatalogUpdatedDelta,
        provenanceCreatedDelta,
      };
    },
    { timeout: 60_000, maxWait: 60_000 },
  );
}

function buildProvenanceCreateData(
  params: Pick<ApplyParams, 'workspaceId' | 'inventory'>,
  entry: BootstrapPlanEntry,
  resourceCatalogId: string,
): Prisma.ResourceSourceIdentityUncheckedCreateInput {
  return {
    resourceCatalogId,
    workspaceId: params.workspaceId,
    sourceSha256: params.inventory.sourceSha256,
    sourceFileName: params.inventory.sourceFileName,
    parserContractVersion: params.inventory.parserContractVersion,
    sheetName: params.inventory.sheetName,
    sourceRowNumber: entry.sourceRowNumber,
    sourceSection: entry.sourceSection,
    sourceCodeCellAddress: entry.sourceCodeCellAddress,
    sourceNameCellAddress: entry.sourceNameCellAddress,
    sourceUnitCellAddress: entry.sourceUnitCellAddress,
    rawCode: entry.rawResourceCodeText,
    rawName: entry.rawResourceNameText,
    rawUnit: entry.rawUnitText,
  };
}

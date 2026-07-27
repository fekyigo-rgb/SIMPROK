import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient, type ResourceType } from '@prisma/client';

import {
  EXPECTED_PARSER_CONTRACT_VERSION,
  EXPECTED_SHEET_NAME,
  EXPECTED_SOURCE_SHA256,
  loadCanonicalInventory,
  type CanonicalInventory,
} from './resource-catalog-bootstrap-planner';

/**
 * RM-02C1c — Missing-Unit Human Disposition.
 *
 * Closes exactly the two RM-02C1b blocked source rows (39, 104) through an
 * explicit Owner domain decision. This is deliberately a separate, narrow
 * module — not an extension of resource-catalog-bootstrap-planner.ts's
 * locked 271-row planner, and not a generic "missing unit" resolution
 * framework. It reuses that module's already-proven inventory
 * verification (`loadCanonicalInventory` and its EXPECTED_* pins) because
 * both slices must agree on the exact same canonical source evidence, but
 * defines its own plan shape, its own three-disposition enum, and its own
 * apply transaction/lock scope.
 *
 * ACCEPTANCE-ONLY HUMAN DISPOSITION — NOT A GLOBAL OR PRODUCTION UNIT
 * STANDARD. This records only what the Owner approved for these two exact
 * source rows in this one source workbook. It does not assert that every
 * "Kawat BRC" is Buah, that every "Kerikil" is M3, or that Buah/Unit/Lembar
 * are equivalent. A future source with an explicit, different unit for
 * either name is a separate, independently reviewed identity — never
 * auto-merged, auto-converted, or silently reconciled with this one.
 */

export const PLAN_CONTRACT_VERSION = 'RM02C1C_MISSING_UNIT_DISPOSITION_PLAN_V1';
export const CONFIRMATION_TOKEN = 'APPLY_RM02C1C_TO_SIMPROK_TEST';

interface OwnerDisposition {
  readonly sourceRowNumber: number;
  readonly expectedRawName: string;
  readonly expectedSection: ResourceType;
  readonly acceptedBaseUnit: string;
}

/**
 * The entire authority for this slice. Exactly two rows, exactly these two
 * Owner-approved units. Adding a third row or changing either unit here
 * would be a new Owner decision, not a code change to this constant.
 */
const OWNER_DISPOSITIONS: readonly OwnerDisposition[] = [
  { sourceRowNumber: 39, expectedRawName: 'Kawat BRC', expectedSection: 'MATERIAL', acceptedBaseUnit: 'Buah' },
  { sourceRowNumber: 104, expectedRawName: 'Kerikil', expectedSection: 'MATERIAL', acceptedBaseUnit: 'M3' },
];

export class CanonicalEvidenceMismatchError extends Error {
  constructor(detail: string) {
    super(`STOP_CANONICAL_EVIDENCE_MISMATCH: ${detail}`);
    this.name = 'CanonicalEvidenceMismatchError';
  }
}

export type MissingUnitDisposition = 'CREATE_REVIEWED_RESOURCE' | 'IDEMPOTENT_ALREADY_APPLIED' | 'CONFLICT_STOP';

export interface MissingUnitPlanEntry {
  readonly sourceRowNumber: number;
  readonly sourceName: string;
  readonly sourceRawUnit: null;
  readonly sourceCodeCellAddress: string | null;
  readonly sourceNameCellAddress: string;
  readonly sourceUnitCellAddress: string | null;
  readonly acceptedBaseUnit: string;
  readonly canonicalCode: null;
  readonly disposition: MissingUnitDisposition;
  readonly conflictReason: string | null;
}

export interface MissingUnitPlan {
  readonly planContractVersion: string;
  readonly inventoryPath: string;
  readonly inventorySha256: string;
  readonly sourceSha256: string;
  readonly parserContractVersion: string;
  readonly sheetName: string;
  readonly workspaceId: string;
  readonly generatedFromGitHead: string;
  readonly decisionAuthority: 'OWNER';
  readonly decisionRecord: string;
  readonly entries: readonly MissingUnitPlanEntry[];
}

const DECISION_RECORD =
  'ACCEPTANCE-ONLY HUMAN DISPOSITION — NOT A GLOBAL OR PRODUCTION UNIT STANDARD. ' +
  'Owner-approved for source rows 39 (Kawat BRC -> Buah) and 104 (Kerikil -> M3) only, ' +
  'scoped to Workspace-A / simprok_test / this exact source workbook. Source rawUnit for ' +
  'both rows was empty and remains NULL in provenance; the accepted unit is recorded only ' +
  'on ResourceCatalog.baseUnit. No unit conversion, alias, or equivalence is inferred or ' +
  'authorized by this decision; a future source presenting an explicit different unit for ' +
  'either name is a separate, independently reviewed identity.';

/**
 * Re-verifies rows 39 and 104 against the committed RM-02C0 inventory
 * exactly as the governing contract requires — throws
 * CanonicalEvidenceMismatchError (never silently reinterprets a row) if the
 * evidence has drifted from what this slice was authorized against.
 */
export function verifyOwnerDispositionAgainstEvidence(inventory: CanonicalInventory): void {
  for (const decision of OWNER_DISPOSITIONS) {
    const row = inventory.rows.find((r) => r.sourceRowNumber === decision.sourceRowNumber);
    if (!row) {
      throw new CanonicalEvidenceMismatchError(`source row ${decision.sourceRowNumber} not found in inventory.`);
    }
    if (row.sourceSection !== decision.expectedSection) {
      throw new CanonicalEvidenceMismatchError(
        `source row ${decision.sourceRowNumber} sourceSection is "${row.sourceSection}", expected "${decision.expectedSection}".`,
      );
    }
    if (row.rawResourceNameText !== decision.expectedRawName) {
      throw new CanonicalEvidenceMismatchError(
        `source row ${decision.sourceRowNumber} rawResourceNameText is "${row.rawResourceNameText}", expected "${decision.expectedRawName}".`,
      );
    }
    if (row.rawUnitText !== null) {
      throw new CanonicalEvidenceMismatchError(
        `source row ${decision.sourceRowNumber} rawUnitText is "${row.rawUnitText}", expected NULL — this slice is only authorized for genuinely empty source unit cells.`,
      );
    }
  }
}

type QueryClient = PrismaClient | Prisma.TransactionClient;

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

interface ExistingCatalogRow {
  id: string;
  workspaceId: string | null;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  status: string;
}

async function computeEntryForDecision(
  client: QueryClient,
  decision: OwnerDisposition,
  inventoryRow: CanonicalInventory['rows'][number],
  workspaceId: string,
  sourceSha256: string,
  sheetName: string,
  parserContractVersion: string,
): Promise<MissingUnitPlanEntry> {
  const base = {
    sourceRowNumber: decision.sourceRowNumber,
    sourceName: decision.expectedRawName,
    sourceRawUnit: null,
    sourceCodeCellAddress: inventoryRow.sourceCodeCellAddress,
    sourceNameCellAddress: inventoryRow.sourceNameCellAddress,
    sourceUnitCellAddress: inventoryRow.sourceUnitCellAddress,
    acceptedBaseUnit: decision.acceptedBaseUnit,
    canonicalCode: null,
  };

  const existingProvenance: ExistingProvenanceRow | null = await client.resourceSourceIdentity.findFirst({
    where: { workspaceId, sourceSha256, sheetName, parserContractVersion, sourceRowNumber: decision.sourceRowNumber },
  });

  if (existingProvenance) {
    const rawMatches =
      existingProvenance.rawCode === null &&
      existingProvenance.rawName === decision.expectedRawName &&
      existingProvenance.rawUnit === null &&
      existingProvenance.sourceCodeCellAddress === inventoryRow.sourceCodeCellAddress &&
      existingProvenance.sourceNameCellAddress === inventoryRow.sourceNameCellAddress &&
      existingProvenance.sourceUnitCellAddress === inventoryRow.sourceUnitCellAddress;
    if (!rawMatches) {
      return {
        ...base,
        disposition: 'CONFLICT_STOP',
        conflictReason: `STOP_EXISTING_PROVENANCE_CONFLICT: existing provenance for source row ${decision.sourceRowNumber} does not match the committed source (rawCode/rawName/rawUnit).`,
      };
    }
    const linkedCatalog: ExistingCatalogRow | null = await client.resourceCatalog.findUnique({
      where: { id: existingProvenance.resourceCatalogId },
    });
    const catalogMatches =
      !!linkedCatalog &&
      linkedCatalog.workspaceId === workspaceId &&
      linkedCatalog.code === null &&
      linkedCatalog.name === decision.expectedRawName &&
      linkedCatalog.type === decision.expectedSection &&
      linkedCatalog.baseUnit === decision.acceptedBaseUnit &&
      linkedCatalog.status === 'ACTIVE';
    if (!catalogMatches) {
      return {
        ...base,
        disposition: 'CONFLICT_STOP',
        conflictReason: `STOP_EXISTING_PROVENANCE_CONFLICT: existing provenance for source row ${decision.sourceRowNumber} links to a ResourceCatalog that no longer matches the approved disposition (name/type/baseUnit/code/status).`,
      };
    }
    return { ...base, disposition: 'IDEMPOTENT_ALREADY_APPLIED', conflictReason: null };
  }

  // CASE D: an exact, unproven candidate already exists at the *approved*
  // unit — refuse to silently attach to it. A candidate at a *different*
  // unit (CASE E) simply never matches this query, so it never blocks —
  // that is what keeps CASE D and CASE E structurally distinct here.
  // Deliberately no `status` filter: a soft-retired/INACTIVE row matching
  // name+type+baseUnit still counts as a collision here. That is the safe
  // direction to fail closed in — do not "fix" this into filtering by
  // status=ACTIVE, which would let this code silently attach to (or
  // ignore) a resource a human has already retired for a reason this
  // slice has no way to know.
  const unprovenCandidate: ExistingCatalogRow | null = await client.resourceCatalog.findFirst({
    where: {
      workspaceId,
      name: decision.expectedRawName,
      type: decision.expectedSection,
      baseUnit: decision.acceptedBaseUnit,
    },
  });
  if (unprovenCandidate) {
    return {
      ...base,
      disposition: 'CONFLICT_STOP',
      conflictReason: `STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION: an existing ResourceCatalog already matches name="${decision.expectedRawName}"/type=${decision.expectedSection}/baseUnit="${decision.acceptedBaseUnit}" for source row ${decision.sourceRowNumber} without matching provenance. Refusing to auto-attach.`,
    };
  }

  return { ...base, disposition: 'CREATE_REVIEWED_RESOURCE', conflictReason: null };
}

export interface BuildMissingUnitPlanParams {
  readonly inventory: CanonicalInventory;
  readonly inventoryPath: string;
  readonly inventorySha256: string;
  readonly workspaceId: string;
  readonly generatedFromGitHead: string;
}

export async function buildMissingUnitPlan(
  client: QueryClient,
  params: BuildMissingUnitPlanParams,
): Promise<MissingUnitPlan> {
  verifyOwnerDispositionAgainstEvidence(params.inventory);

  const entries: MissingUnitPlanEntry[] = [];
  for (const decision of [...OWNER_DISPOSITIONS].sort((a, b) => a.sourceRowNumber - b.sourceRowNumber)) {
    const inventoryRow = params.inventory.rows.find((r) => r.sourceRowNumber === decision.sourceRowNumber);
    if (!inventoryRow) {
      throw new CanonicalEvidenceMismatchError(`source row ${decision.sourceRowNumber} not found in inventory.`);
    }
    entries.push(
      await computeEntryForDecision(
        client,
        decision,
        inventoryRow,
        params.workspaceId,
        params.inventory.sourceSha256,
        params.inventory.sheetName,
        params.inventory.parserContractVersion,
      ),
    );
  }

  return {
    planContractVersion: PLAN_CONTRACT_VERSION,
    inventoryPath: params.inventoryPath,
    inventorySha256: params.inventorySha256,
    sourceSha256: params.inventory.sourceSha256,
    parserContractVersion: params.inventory.parserContractVersion,
    sheetName: params.inventory.sheetName,
    workspaceId: params.workspaceId,
    generatedFromGitHead: params.generatedFromGitHead,
    decisionAuthority: 'OWNER',
    decisionRecord: DECISION_RECORD,
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

export function canonicalMissingUnitPlanJson(plan: MissingUnitPlan): string {
  return JSON.stringify(canonicalize(plan), null, 2);
}

export function computeMissingUnitPlanHash(plan: MissingUnitPlan): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex').toUpperCase();
}

export class MissingUnitApplyError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'MissingUnitApplyError';
  }
}

// PLAN_CONTRACT_VERSION is read as the module-level constant, not passed
// as a parameter, unlike the sibling bootstrap-planner's equivalent
// function — deliberate: this narrow, two-row slice has exactly one plan
// contract version and is not expected to ever need a second one. If a
// future contract bump ever changes the plan shape, bump this constant too
// so the lock scope changes with it, rather than adding a parameter here.
function advisoryLockKey(workspaceId: string, sourceSha256: string): bigint {
  const digest = createHash('sha256')
    .update(`rm02c1c|${workspaceId}|${sourceSha256}|${PLAN_CONTRACT_VERSION}`)
    .digest('hex');
  return BigInt(`0x${digest.slice(0, 15)}`);
}

export interface ApplyMissingUnitParams extends BuildMissingUnitPlanParams {
  readonly expectedPlanSha256: string;
  readonly confirmationToken: string;
  /** Test-only seam — see resource-catalog-bootstrap-planner.ts's identical pattern. */
  readonly injectFailureAfterSourceRowNumber?: number;
}

export interface ApplyMissingUnitResult {
  readonly plan: MissingUnitPlan;
  readonly planSha256: string;
  readonly resourceCatalogCreatedDelta: number;
  readonly provenanceCreatedDelta: number;
}

export async function applyMissingUnitPlan(
  prisma: PrismaClient,
  params: ApplyMissingUnitParams,
): Promise<ApplyMissingUnitResult> {
  if (params.confirmationToken !== CONFIRMATION_TOKEN) {
    throw new MissingUnitApplyError(
      'STOP_MISSING_CONFIRMATION_TOKEN',
      `Refusing to apply: confirmationToken must be exactly "${CONFIRMATION_TOKEN}".`,
    );
  }
  if (params.injectFailureAfterSourceRowNumber !== undefined && process.env.NODE_ENV !== 'test') {
    throw new MissingUnitApplyError(
      'STOP_TEST_ONLY_PARAMETER_OUTSIDE_TEST',
      'injectFailureAfterSourceRowNumber was supplied outside a test process (NODE_ENV !== "test") — refusing to honor a test-only failure-injection seam against a real environment.',
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const lockKey = advisoryLockKey(params.workspaceId, params.inventory.sourceSha256);
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      const plan = await buildMissingUnitPlan(tx, params);
      const planSha256 = computeMissingUnitPlanHash(plan);

      if (planSha256 !== params.expectedPlanSha256.toUpperCase()) {
        throw new MissingUnitApplyError(
          'STOP_STALE_PLAN_HASH',
          `Live plan hash ${planSha256} does not match the confirmed plan hash ${params.expectedPlanSha256}.`,
        );
      }

      const conflicts = plan.entries.filter((e) => e.disposition === 'CONFLICT_STOP');
      if (conflicts.length > 0) {
        throw new MissingUnitApplyError(
          'STOP_CONFLICTS_PRESENT',
          `Refusing to apply: ${conflicts.length} row(s) have disposition CONFLICT_STOP: ${conflicts.map((c) => `row ${c.sourceRowNumber} (${c.conflictReason})`).join('; ')}`,
        );
      }

      let resourceCatalogCreatedDelta = 0;
      let provenanceCreatedDelta = 0;

      for (const entry of plan.entries) {
        if (entry.disposition === 'CREATE_REVIEWED_RESOURCE') {
          const catalog = await tx.resourceCatalog.create({
            data: {
              workspaceId: params.workspaceId,
              code: null,
              name: entry.sourceName,
              type: 'MATERIAL',
              baseUnit: entry.acceptedBaseUnit,
              status: 'ACTIVE',
            },
          });
          resourceCatalogCreatedDelta += 1;
          await tx.resourceSourceIdentity.create({
            data: {
              resourceCatalogId: catalog.id,
              workspaceId: params.workspaceId,
              sourceSha256: params.inventory.sourceSha256,
              sourceFileName: params.inventory.sourceFileName,
              parserContractVersion: params.inventory.parserContractVersion,
              sheetName: params.inventory.sheetName,
              sourceRowNumber: entry.sourceRowNumber,
              sourceSection: 'MATERIAL',
              sourceCodeCellAddress: entry.sourceCodeCellAddress,
              sourceNameCellAddress: entry.sourceNameCellAddress,
              sourceUnitCellAddress: entry.sourceUnitCellAddress,
              rawCode: null,
              rawName: entry.sourceName,
              rawUnit: null,
            },
          });
          provenanceCreatedDelta += 1;
        } else if (entry.disposition === 'IDEMPOTENT_ALREADY_APPLIED') {
          // No writes — already applied and verified matching above.
        } else {
          throw new MissingUnitApplyError(
            'STOP_UNHANDLED_DISPOSITION',
            `Row ${entry.sourceRowNumber} has disposition "${entry.disposition}", which has no write behavior wired into applyMissingUnitPlan.`,
          );
        }

        if (params.injectFailureAfterSourceRowNumber === entry.sourceRowNumber) {
          throw new Error(`INJECTED_TEST_FAILURE_AFTER_ROW_${entry.sourceRowNumber}`);
        }
      }

      return { plan, planSha256, resourceCatalogCreatedDelta, provenanceCreatedDelta };
    },
    { timeout: 60_000, maxWait: 60_000 },
  );
}

export { EXPECTED_SOURCE_SHA256, EXPECTED_PARSER_CONTRACT_VERSION, EXPECTED_SHEET_NAME, loadCanonicalInventory };
export type { CanonicalInventory };

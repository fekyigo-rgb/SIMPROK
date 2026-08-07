import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
  applyBootstrapPlan,
  buildPlan,
  canonicalPlanJson,
  computePlanHash,
  loadCanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-bootstrap-planner';
import {
  CANONICAL_REFERENCE_WORKSPACE_ID,
  verifyCanonicalReferenceAuthority,
} from '../../src/canonical-reference/canonical-reference-target';
import {
  REGION_CONFIRMATION_TOKEN,
  applyRegionPlan,
  buildRegionPlan,
  canonicalRegionPlanJson,
  computeRegionPlanHash,
} from '../../src/canonical-reference/region-provisioner';
import { provisionCanonicalReferences } from '../../src/canonical-reference/reference-provisioning-sequence';

/**
 * RM-03D0 — the canonical-safe entry point for reference-data provisioning.
 *
 * This is the sibling of scripts/rm02c1b/resource-catalog-bootstrap.ts, not a
 * replacement for it. That wrapper stays acceptance-only and is untouched:
 * it still loads .env.test, still runs verifyAcceptanceDatabase, and still
 * refuses anything but simprok_test. This file never imports it.
 *
 * Everything with real law in it lives in src/ and is unit-tested there
 * (canonical-reference-target.spec.ts, region-provisioner.spec.ts,
 * confirmation-authority.spec.ts). What remains here is wiring: read env,
 * prove the target, delegate, print. Deliberately so — scripts/ is outside
 * the standard `npm test` rootDir, and law that cannot be tested by the
 * normal gate should not live here.
 *
 * ORDER (RM-03D0 §10): Region first, then ResourceCatalog. The catalog is
 * region-free, so the order is about reviewability, not a data dependency.
 *
 * CREDENTIALS: DATABASE_URL is read from the process environment, supplied by
 * an authorized ops runner. It is never accepted as an argument and never
 * printed. Only database name, host and port are ever reported.
 *
 * DB ROLE: the future canonical apply runs as simprok_app — the existing
 * least-privileged role that already holds INSERT on these bounded reference
 * tables. This file neither creates nor broadens any role.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const INVENTORY_PATH = resolve(
  REPO_ROOT,
  'docs',
  'implementation-gates',
  'rm02c0-discovery',
  '01-RM02C0-RESOURCE-INVENTORY.json',
);

/** The RM-02C0 locked inventory hash — identical to the acceptance wrapper's. */
const EXPECTED_INVENTORY_SHA256 =
  'CE2B3AEBC50179FB2DF46D5EB55ED39EF68347421C8F8DE043C6D3CA00E64C46';

const EXPECTED_PLAN_HASH_ENV = 'RM03D0_EXPECTED_PLAN_SHA256';
const EXPECTED_REGION_PLAN_HASH_ENV = 'RM03D0_EXPECTED_REGION_PLAN_SHA256';
const CONFIRMATION_TOKEN_ENV = 'RM03D0_CONFIRMATION_TOKEN';

function gitHead(): string {
  return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
}

function getArg(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const hasDryRun = argv.includes('--dry-run');
  const hasApply = argv.includes('--apply');
  if (hasDryRun === hasApply) {
    throw new Error('STOP_INVALID_MODE: pass exactly one of --dry-run or --apply');
  }

  // Region is DESIGNATED, never derived. Both halves are required in both
  // modes so a dry-run plans exactly what an apply would do.
  const regionCode = getArg(argv, 'region-code');
  const regionName = getArg(argv, 'region-name');
  if (!regionCode || !regionName) {
    throw new Error(
      'STOP_REGION_DESIGNATION_REQUIRED: --region-code and --region-name are required; this tool never infers a region.',
    );
  }

  const prisma = new PrismaClient();
  try {
    // Prove the target before reading or writing anything: DSN coordinates,
    // then the live connection itself, then the authorized workspace.
    // The writer role is enforced on APPLY only: a dry-run writes nothing, so
    // it may legitimately run as the read-only audit role.
    const authority = await verifyCanonicalReferenceAuthority({
      databaseUrl: process.env.DATABASE_URL,
      workspaceId: CANONICAL_REFERENCE_WORKSPACE_ID,
      requireWriterRole: hasApply,
      client: {
        query: async (sql: string) => ({
          rows: (await prisma.$queryRawUnsafe(sql)) as never[],
        }),
      },
    });
    process.stderr.write(
      `CANONICAL_TARGET_GUARD=PASS db=${authority.target.databaseName} host=${authority.target.host} port=${authority.target.port} role=${authority.currentRole ?? 'UNKNOWN'} writerRoleEnforced=${authority.writerRoleEnforced}\n`,
    );

    const { inventory, inventorySha256 } = loadCanonicalInventory(
      INVENTORY_PATH,
      EXPECTED_INVENTORY_SHA256,
    );
    const generatedFromGitHead = gitHead();

    // A FRESH plan against current canonical state. The RM-02C1b Workspace-A
    // plan hash is never reused — a plan is a statement about one database at
    // one moment, and this is a different database and a different workspace.
    const regionPlan = await buildRegionPlan(prisma, { regionCode, regionName });
    const regionPlanSha256 = computeRegionPlanHash(regionPlan);

    const catalogPlan = await buildPlan(prisma, {
      inventory,
      inventoryPath: INVENTORY_PATH,
      inventorySha256,
      workspaceId: authority.workspaceId,
      generatedFromGitHead,
    });
    const catalogPlanSha256 = computePlanHash(catalogPlan);

    if (hasDryRun) {
      process.stdout.write(`${canonicalRegionPlanJson(regionPlan)}\n`);
      process.stdout.write(`${canonicalPlanJson(catalogPlan)}\n`);
      process.stderr.write(`REGION_PLAN_SHA256=${regionPlanSha256}\n`);
      process.stderr.write(`RESOURCE_CATALOG_PLAN_SHA256=${catalogPlanSha256}\n`);
      process.stderr.write('CANONICAL_WRITE=0\n');
      return;
    }

    const confirmationToken = process.env[CONFIRMATION_TOKEN_ENV];
    const expectedRegionPlanSha256 = process.env[EXPECTED_REGION_PLAN_HASH_ENV];
    const expectedCatalogPlanSha256 = process.env[EXPECTED_PLAN_HASH_ENV];
    if (!confirmationToken || !expectedRegionPlanSha256 || !expectedCatalogPlanSha256) {
      throw new Error(
        `STOP_MISSING_APPLY_AUTHORITY: apply requires ${CONFIRMATION_TOKEN_ENV}, ${EXPECTED_REGION_PLAN_HASH_ENV} and ${EXPECTED_PLAN_HASH_ENV} to be set explicitly — refusing to guess or default any of them.`,
      );
    }

    // Region first, then ResourceCatalog. They are two transactions; if the
    // Region commits and the catalog then fails, the sequence raises
    // STOP_PARTIAL_REFERENCE_STATE naming the committed Region rather than
    // cleaning anything up.
    const { region: regionResult, catalog: catalogResult } =
      await provisionCanonicalReferences({
        applyRegion: () =>
          applyRegionPlan(prisma, {
            regionCode,
            regionName,
            expectedPlanSha256: expectedRegionPlanSha256,
            confirmationToken,
            expectedConfirmationToken: REGION_CONFIRMATION_TOKEN,
          }),
        // The existing reviewed planner — same transaction, advisory lock,
        // provenance and idempotency law as RM-02C1b; only the confirmation
        // authority differs.
        applyResourceCatalog: () =>
          applyBootstrapPlan(prisma, {
            expectedPlanSha256: expectedCatalogPlanSha256,
            confirmationToken,
            expectedConfirmationToken: CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
            workspaceId: authority.workspaceId,
            inventory,
            inventoryPath: INVENTORY_PATH,
            inventorySha256,
            generatedFromGitHead,
          }),
      });

    process.stdout.write(
      `${JSON.stringify(
        {
          regionPlanSha256: regionResult.planSha256,
          regionId: regionResult.regionId,
          regionCreatedDelta: regionResult.regionCreatedDelta,
          regionReusedDelta: regionResult.regionReusedDelta,
          resourceCatalogPlanSha256: catalogResult.planSha256,
          resourceCatalogCreatedDelta: catalogResult.resourceCatalogCreatedDelta,
          resourceCatalogReusedDelta: catalogResult.resourceCatalogReusedDelta,
          resourceCatalogUpdatedDelta: catalogResult.resourceCatalogUpdatedDelta,
          provenanceCreatedDelta: catalogResult.provenanceCreatedDelta,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Never echo a connection string or a credential, even on failure.
  process.stderr.write(
    `${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`,
  );
  process.exitCode = 1;
});

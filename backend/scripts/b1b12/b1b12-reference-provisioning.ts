import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
  applyBootstrapPlan,
  buildPlan,
  canonicalPlanJson,
  computePlanHash,
  loadCanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-bootstrap-planner';
import {
  GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
  applyRegionPlan,
  buildRegionPlan,
  canonicalRegionPlanJson,
  computeRegionPlanHash,
} from '../../src/canonical-reference/region-provisioner';
import { provisionCanonicalReferences } from '../../src/canonical-reference/reference-provisioning-sequence';
import { parseGovernedEnvFile } from '../../src/rehearsal/b1b12-rehearsal-environment';
import {
  assertB1B12RehearsalTarget,
  assertLiveB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
} from '../../src/rehearsal/b1b12-rehearsal-target';

/**
 * B1B12 — give the rehearsal database the reference knowledge the Owner's
 * workspace already has.
 *
 * WHY THIS EXISTS. A rehearsal is only worth running if SIMPROK answers it with
 * the knowledge it would answer the real environment with. The rehearsal
 * database held 45 drainage fixtures and three "Jakarta Selatan" provisioning
 * regions, so the Owner's 86-row IKK workbook met a Resource Identity authority
 * that had never heard of a single one of its names. That is a TRUE answer
 * about an empty database and a FALSE picture of the Owner's — and the tempting
 * repair, having the test create the rows its own workbook needs, proves the
 * plumbing while crediting the engine with finding what the test just planted.
 *
 * THE THIRD THIN WRAPPER, NOT A THIRD IMPLEMENTATION. Every rule with law in it
 * already exists and is reused verbatim:
 *
 *   scripts/rm02c1b/resource-catalog-bootstrap.ts   acceptance  (simprok_test)
 *   scripts/rm03d0/canonical-reference-provisioning.ts canonical (simprok_db)
 *   THIS FILE                                        rehearsal  (b1b12 only)
 *
 * Same reviewed RM-02C0 inventory, same SHA pin, same planner, same identity
 * and provenance law, same Region designation rules, same plan-hash review, same
 * two-step sequence and the same partial-state law. What differs is exactly one
 * thing: which database may be written, and that is decided by
 * `parseRehearsalTargetFromUrl` — the same guard the rehearsal backend and the
 * rehearsal provisioner already obey, which admits one host, one port and one
 * database-name shape and has no override.
 *
 * IT INVENTS NO REFERENCE FACT. Not one resource name here comes from the
 * workbook being rehearsed. The inventory is the reviewed parse of the Owner's
 * own `BASIC PRICE(1).xlsx`, pinned by SHA-256, and it was authored long before
 * the IKK workbook existed — which is why it misses most of that workbook's
 * names. That miss is the honest measurement this whole exercise is for.
 *
 * THE REGION IS DESIGNATED, NEVER DERIVED, exactly as the canonical wrapper
 * requires: both `--region-code` and `--region-name` are mandatory in both
 * modes, and the provisioner refuses to trim, case-fold or guess either.
 *
 * CREDENTIALS: read from the governed B1B12 env file by the same parser the
 * rehearsal launcher uses. Never accepted as an argument, never printed. Only
 * host, port and database name are ever reported.
 *
 *   npm run b1b12:references:rehearsal -- --dry-run --region-code=... --region-name=...
 *   npm run b1b12:references:rehearsal -- --apply   --region-code=... --region-name=... \
 *       --workspace-id=<rehearsal workspace uuid>
 */

const GOVERNED_ENV_FILE =
  'C:/Users/asus/SIMPROK-RUNTIME/secrets/b1b12.backend.env';
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const INVENTORY_PATH = resolve(
  REPO_ROOT,
  'docs',
  'implementation-gates',
  'rm02c0-discovery',
  '01-RM02C0-RESOURCE-INVENTORY.json',
);

/** The RM-02C0 locked inventory hash — identical to both sibling wrappers. */
const EXPECTED_INVENTORY_SHA256 =
  'CE2B3AEBC50179FB2DF46D5EB55ED39EF68347421C8F8DE043C6D3CA00E64C46';

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
    throw new Error(
      'STOP_INVALID_MODE: pass exactly one of --dry-run or --apply',
    );
  }

  const regionCode = getArg(argv, 'region-code');
  const regionName = getArg(argv, 'region-name');
  if (!regionCode || !regionName) {
    throw new Error(
      'STOP_REGION_DESIGNATION_REQUIRED: --region-code and --region-name are required; this tool never infers a region.',
    );
  }

  const workspaceId = getArg(argv, 'workspace-id');
  if (!workspaceId) {
    throw new Error(
      'STOP_WORKSPACE_REQUIRED: --workspace-id is required; the rehearsal workspace is never guessed.',
    );
  }

  // THE TARGET IS PROVEN BEFORE ANYTHING IS READ OR WRITTEN. The governed file
  // is the only source of the DSN, and the rehearsal guard is the only thing
  // that decides whether it may be opened. A DSN aimed anywhere else — the
  // Permanent cluster, the legacy cluster, another database on 55433 — is
  // refused here, before a Prisma client exists.
  const governed = parseGovernedEnvFile(
    readFileSync(GOVERNED_ENV_FILE, 'utf8'),
  );
  const databaseUrl = governed.get('DATABASE_URL');
  const declared = parseRehearsalTargetFromUrl(databaseUrl);
  // PARSING IS NOT PROOF. `parseRehearsalTargetFromUrl` only extracts
  // coordinates; the allow-list — one host, one port, one database-name shape —
  // lives in `assertB1B12RehearsalTarget`. This wrapper printed
  // `B1B12_TARGET_GUARD=PASS` off the parse alone, which is a guarantee it had
  // not actually obtained: a DSN aimed at the Permanent cluster parses
  // perfectly. Both sibling wrappers assert; the one that WRITES reference data
  // must not be the lenient one.
  assertB1B12RehearsalTarget(declared);
  process.stderr.write(
    `B1B12_TARGET_GUARD=PASS host=${declared.host} port=${declared.port} db=${declared.databaseName}\n`,
  );

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    // …and the SERVER is judged again by the same law, because a DSN can be
    // right while the connection is not (pooler, tunnel, relocated host/port in
    // the query string). Same probe shape the owner-browser provisioner uses.
    const target = await assertLiveB1B12RehearsalTarget({
      query: async <Row extends Record<string, unknown>>(sql: string) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(sql),
      }),
    });
    process.stderr.write(
      `B1B12_LIVE_TARGET_GUARD=PASS host=${target.host} port=${target.port} db=${target.databaseName}\n`,
    );
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) {
      throw new Error(
        `STOP_WORKSPACE_NOT_FOUND: no workspace ${workspaceId} exists in ${target.databaseName}.`,
      );
    }

    const { inventory, inventorySha256 } = loadCanonicalInventory(
      INVENTORY_PATH,
      EXPECTED_INVENTORY_SHA256,
    );
    const generatedFromGitHead = gitHead();

    const regionPlan = await buildRegionPlan(prisma, {
      regionCode,
      regionName,
    });
    const regionPlanSha256 = computeRegionPlanHash(regionPlan);
    const catalogPlan = await buildPlan(prisma, {
      inventory,
      inventoryPath: INVENTORY_PATH,
      inventorySha256,
      workspaceId,
      generatedFromGitHead,
    });
    const planSha256 = computePlanHash(catalogPlan);

    process.stdout.write(
      [
        `MODE               ${hasApply ? 'APPLY' : 'DRY_RUN'}`,
        `DB                 ${target.host}:${target.port}/${target.databaseName}`,
        `WORKSPACE          ${workspace.id} (${workspace.name})`,
        `INVENTORY_SHA256   ${inventorySha256}`,
        `SOURCE_SHA256      ${inventory.sourceSha256}`,
        `REGION             ${regionPlan.disposition} ${regionCode} / ${regionName}`,
        `REGION_PLAN_SHA256 ${regionPlanSha256}`,
        `CATALOG_PLAN_SHA256 ${planSha256}`,
        `DISPOSITIONS       ${JSON.stringify(catalogPlan.dispositionCounts)}`,
        '',
      ].join('\n'),
    );

    if (!hasApply) {
      process.stdout.write('DRY_RUN_ONLY: nothing was written.\n');
      return;
    }

    // The same two-step sequence and the same partial-state law the canonical
    // wrapper uses. Region first, then catalog; a partial outcome is reported
    // as the fact it is and never silently compensated.
    const result = await provisionCanonicalReferences({
      applyRegion: async () => {
        const applied = await applyRegionPlan(prisma, {
          regionCode,
          regionName,
          expectedPlanSha256: regionPlanSha256,
          confirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
          expectedConfirmationToken:
            GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
        });
        return {
          regionId: applied.regionId,
          regionCreatedDelta: applied.regionCreatedDelta,
          regionReusedDelta: applied.regionReusedDelta,
          planSha256: regionPlanSha256,
        };
      },
      applyResourceCatalog: () =>
        applyBootstrapPlan(prisma, {
          expectedPlanSha256: planSha256,
          confirmationToken: GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
          expectedConfirmationToken: GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
          workspaceId,
          inventory,
          inventoryPath: INVENTORY_PATH,
          inventorySha256,
          generatedFromGitHead,
        }),
    });

    process.stdout.write(
      [
        `REGION_ID          ${result.region.regionId}`,
        `REGION_CREATED     ${result.region.regionCreatedDelta}`,
        `REGION_REUSED      ${result.region.regionReusedDelta}`,
        `CATALOG_CREATED    ${result.catalog.resourceCatalogCreatedDelta}`,
        `CATALOG_REUSED     ${result.catalog.resourceCatalogReusedDelta}`,
        `CATALOG_UPDATED    ${result.catalog.resourceCatalogUpdatedDelta}`,
        `PROVENANCE_CREATED ${result.catalog.provenanceCreatedDelta}`,
        '',
      ].join('\n'),
    );
    // Printed last so a reviewer can diff what was planned against what ran.
    process.stderr.write(
      `REGION_PLAN=${canonicalRegionPlanJson(regionPlan).length}B CATALOG_PLAN=${canonicalPlanJson(catalogPlan).length}B\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`B1B12 REFERENCE PROVISIONING FAIL: ${message}\n`);
  process.exitCode = 1;
});

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  loadAcceptanceEnvironment,
  verifyAcceptanceDatabase,
} from '../database-role-guards';
import {
  applyBootstrapPlan,
  buildPlan,
  canonicalPlanJson,
  computePlanHash,
  loadCanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-bootstrap-planner';

/**
 * RM-02C1b CLI — the only sanctioned entry point for the reviewed resource
 * catalog bootstrap against a real environment. This is the "safe wrapper":
 * it loads backend/.env.test, runs the official database guard (refuses
 * anything but simprok_test), then delegates to the guard-agnostic core
 * planner/apply functions in src/resource-catalog/. Disposable-instance
 * proof and unit tests call the core functions directly and never go
 * through this file, by design — see the planner module's header comment.
 */

const WORKSPACE_A_ID = '10000000-0000-4000-8000-000000000004';
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const INVENTORY_PATH = resolve(
  REPO_ROOT,
  'docs',
  'implementation-gates',
  'rm02c0-discovery',
  '01-RM02C0-RESOURCE-INVENTORY.json',
);
const EXPECTED_INVENTORY_SHA256 =
  'CE2B3AEBC50179FB2DF46D5EB55ED39EF68347421C8F8DE043C6D3CA00E64C46';

function gitHead(): string {
  return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
}

async function main(): Promise<void> {
  const mode = process.argv.slice(2)[0];
  if (!['--dry-run', '--apply'].includes(mode)) {
    throw new Error('Use exactly one explicit mode: --dry-run or --apply.');
  }

  loadAcceptanceEnvironment();
  await verifyAcceptanceDatabase();

  const prisma = new PrismaClient();
  try {
    const { inventory, inventorySha256 } = loadCanonicalInventory(INVENTORY_PATH, EXPECTED_INVENTORY_SHA256);
    const generatedFromGitHead = gitHead();

    const plan = await buildPlan(prisma, {
      inventory,
      inventoryPath: INVENTORY_PATH,
      inventorySha256,
      workspaceId: WORKSPACE_A_ID,
      generatedFromGitHead,
    });
    const planSha256 = computePlanHash(plan);

    if (mode === '--dry-run') {
      process.stdout.write(`${canonicalPlanJson(plan)}\n`);
      process.stderr.write(`PLAN_SHA256=${planSha256}\n`);
      return;
    }

    const confirmationToken = process.env.RM02C1B_CONFIRMATION_TOKEN;
    const expectedPlanSha256 = process.env.RM02C1B_EXPECTED_PLAN_SHA256;
    if (!confirmationToken || !expectedPlanSha256) {
      throw new Error(
        'Apply requires RM02C1B_CONFIRMATION_TOKEN and RM02C1B_EXPECTED_PLAN_SHA256 to be set explicitly in the environment — refusing to guess or default either value.',
      );
    }

    const result = await applyBootstrapPlan(prisma, {
      expectedPlanSha256,
      confirmationToken,
      workspaceId: WORKSPACE_A_ID,
      inventory,
      inventoryPath: INVENTORY_PATH,
      inventorySha256,
      generatedFromGitHead,
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          planSha256: result.planSha256,
          resourceCatalogCreatedDelta: result.resourceCatalogCreatedDelta,
          resourceCatalogReusedDelta: result.resourceCatalogReusedDelta,
          resourceCatalogUpdatedDelta: result.resourceCatalogUpdatedDelta,
          provenanceCreatedDelta: result.provenanceCreatedDelta,
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
  process.stderr.write(`${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`);
  process.exitCode = 1;
});

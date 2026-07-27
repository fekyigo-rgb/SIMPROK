import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { loadTestEnv } from '../../test/load-test-env';
import { verifyTestDatabase } from '../test-database-guard';
import {
  EXPECTED_SOURCE_SHA256,
  applyMissingUnitPlan,
  buildMissingUnitPlan,
  canonicalMissingUnitPlanJson,
  computeMissingUnitPlanHash,
  loadCanonicalInventory,
} from '../../src/resource-catalog/resource-catalog-missing-unit-disposition';

/**
 * RM-02C1c CLI — the only sanctioned entry point for the missing-unit
 * human disposition against a real environment. Same wrapper/core-module
 * separation as RM-02C1b's CLI: this file loads backend/.env.test, runs the
 * official database guard, then delegates to the guard-agnostic core
 * functions. Disposable-instance proof and tests call the core functions
 * directly and never go through this file.
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

  loadTestEnv();
  await verifyTestDatabase();

  const prisma = new PrismaClient();
  try {
    const { inventory, inventorySha256 } = loadCanonicalInventory(INVENTORY_PATH, EXPECTED_INVENTORY_SHA256);
    if (inventory.sourceSha256.toUpperCase() !== EXPECTED_SOURCE_SHA256.toUpperCase()) {
      throw new Error(
        `STOP_CANONICAL_EVIDENCE_MISMATCH: inventory sourceSha256 does not match the pinned RM-02C1c source hash.`,
      );
    }
    const generatedFromGitHead = gitHead();

    const plan = await buildMissingUnitPlan(prisma, {
      inventory,
      inventoryPath: INVENTORY_PATH,
      inventorySha256,
      workspaceId: WORKSPACE_A_ID,
      generatedFromGitHead,
    });
    const planSha256 = computeMissingUnitPlanHash(plan);

    if (mode === '--dry-run') {
      process.stdout.write(`${canonicalMissingUnitPlanJson(plan)}\n`);
      process.stderr.write(`PLAN_SHA256=${planSha256}\n`);
      return;
    }

    const confirmationToken = process.env.RM02C1C_CONFIRMATION_TOKEN;
    const expectedPlanSha256 = process.env.RM02C1C_EXPECTED_PLAN_SHA256;
    if (!confirmationToken || !expectedPlanSha256) {
      throw new Error(
        'Apply requires RM02C1C_CONFIRMATION_TOKEN and RM02C1C_EXPECTED_PLAN_SHA256 to be set explicitly in the environment.',
      );
    }

    const result = await applyMissingUnitPlan(prisma, {
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

import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  NATIONAL_REGION_EXPECTED_TOTAL,
  NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV,
  parseNationalRegionProductionMode,
  readProductionConfirmation,
  runNationalRegionProductionDoor,
  type NationalRegionProductionClient,
  type NationalRegionProductionPlan,
} from '../../src/canonical-reference/region-national-production-door';
import { NATIONAL_REGION_EXPECTED_COVERAGE } from '../../src/canonical-reference/region-national-master.gate';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function printPlan(plan: NationalRegionProductionPlan): void {
  process.stdout.write(`TRANSACTION_READ_ONLY=${plan.transactionReadOnly}\n`);
  process.stdout.write(`REGION_SNAPSHOT_COUNT=${plan.regionTotal}\n`);
  process.stdout.write(`REGION_TOTAL=${plan.regionTotal}\n`);
  process.stdout.write(`CANONICAL_REGION_TOTAL=${plan.canonicalRegionTotal}\n`);
  process.stdout.write(
    `NON_MASTER_REGION_TOTAL=${plan.nonMasterRegionTotal}\n`,
  );
  process.stdout.write(
    `NON_MASTER_UNSCOPED_REGION_TOTAL=${plan.nonMasterUnscopedRegionTotal}\n`,
  );
  process.stdout.write(
    `NON_MASTER_STRUCTURED_REGION_TOTAL=${plan.nonMasterStructuredRegionTotal}\n`,
  );
  process.stdout.write(`DESIGNATION_COUNT=${plan.designationCount}\n`);
  process.stdout.write(`PLANNED_CREATE=${plan.plannedCreate}\n`);
  process.stdout.write(`PLANNED_REUSE=${plan.plannedReuse}\n`);
  process.stdout.write(`PLANNED_CONFLICT=${plan.plannedConflict}\n`);
  process.stdout.write(
    `CONFLICT_REASON_COUNTS=${JSON.stringify(plan.conflictReasonCounts)}\n`,
  );
  process.stdout.write(
    `PROSPECTIVE_REGION_TOTAL=${plan.prospectiveRegionTotal}\n`,
  );
  process.stdout.write(
    `PROSPECTIVE_CANONICAL_REGION_TOTAL=${plan.prospectiveCanonicalRegionTotal}\n`,
  );
}

async function main(): Promise<void> {
  const mode = parseNationalRegionProductionMode(process.argv.slice(2));
  const confirmationToken =
    mode === 'apply' ? readProductionConfirmation(process.env) : undefined;
  const prisma = new PrismaClient();

  try {
    const result = await runNationalRegionProductionDoor({
      mode,
      repoRoot: REPO_ROOT,
      databaseUrl: process.env.DATABASE_URL,
      confirmationToken,
      client: prisma as unknown as NationalRegionProductionClient,
      onProgress: (progress) => {
        if (
          progress.processed % 1_000 === 0 ||
          progress.processed === progress.total
        ) {
          process.stdout.write(
            `NATIONAL_REGION_PROGRESS=${JSON.stringify(progress)}\n`,
          );
        }
      },
    });

    process.stdout.write(`MODE=${result.mode.toUpperCase()}\n`);
    process.stdout.write(
      `DATABASE=${result.authority.target.databaseName}\nHOST=${result.authority.target.host}\nPORT=${result.authority.target.port}\n`,
    );
    process.stdout.write(
      `CONFIRMATION_PRESENT=${mode === 'apply' ? 'true' : 'not-required'}\n`,
    );
    process.stdout.write(
      `EXPECTED_COUNTRY=${NATIONAL_REGION_EXPECTED_COVERAGE.COUNTRY}\nEXPECTED_PROVINCE=${NATIONAL_REGION_EXPECTED_COVERAGE.PROVINCE}\nEXPECTED_REGENCY_CITY=${NATIONAL_REGION_EXPECTED_COVERAGE.REGENCY_CITY}\nEXPECTED_DISTRICT=${NATIONAL_REGION_EXPECTED_COVERAGE.DISTRICT}\nEXPECTED_VILLAGE=${NATIONAL_REGION_EXPECTED_COVERAGE.VILLAGE}\nEXPECTED_TOTAL=${NATIONAL_REGION_EXPECTED_TOTAL}\n`,
    );
    printPlan(result.planBefore);

    if (result.mode === 'dry-run') {
      process.stdout.write('CANONICAL_WRITE=0\n');
      return;
    }

    process.stdout.write(
      `APPLY_CREATED=${result.applyResult?.created ?? 0}\nAPPLY_REUSED=${result.applyResult?.reused ?? 0}\n`,
    );
    if (result.planAfter) {
      process.stdout.write('POST_APPLY_VERIFICATION=PASS\n');
      printPlan(result.planAfter);
      process.stdout.write(
        `COUNTRY=${result.planAfter.levelCounts.COUNTRY}\nPROVINCE=${result.planAfter.levelCounts.PROVINCE}\nREGENCY_CITY=${result.planAfter.levelCounts.REGENCY_CITY}\nDISTRICT=${result.planAfter.levelCounts.DISTRICT}\nVILLAGE=${result.planAfter.levelCounts.VILLAGE}\n`,
      );
      process.stdout.write(
        `DUPLICATE_CODE_COUNT=${result.planAfter.duplicateCodeCount}\nMISSING_PARENT_COUNT=${result.planAfter.missingParentCount}\nILLEGAL_PARENT_LEVEL_COUNT=${result.planAfter.illegalParentLevelCount}\n`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`,
    );
    process.exitCode = 1;
  });
}

export { main as runNationalRegionMasterProductionCli };
export { NATIONAL_REGION_PRODUCTION_CONFIRMATION_ENV };

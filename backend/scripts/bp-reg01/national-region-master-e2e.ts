import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyE2EDatabase } from '../database-role-guards';
import {
  NATIONAL_REGION_EXPECTED_COVERAGE,
  assessNationalRegionMaster,
  tryLoadNationalRegionDump,
} from '../../src/canonical-reference/region-national-master.gate';
import { applyNationalRegionMaster } from '../../src/canonical-reference/region-national-master.provisioner';
import { GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN } from '../../src/canonical-reference/region-provisioner';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply === dryRun) {
    throw new Error(
      'STOP_INVALID_MODE: pass exactly one of --dry-run or --apply',
    );
  }

  await verifyE2EDatabase();
  const dump = tryLoadNationalRegionDump(REPO_ROOT);
  const assessment = assessNationalRegionMaster(dump);
  if (!dump || !assessment.nationalMasterComplete) {
    throw new Error(
      `STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE:${assessment.reasonCode}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        database: 'simprok_e2e',
        canonicalWriter: 'applyRegionPlan()',
        coverage: assessment.coverage,
        expectedCoverage: NATIONAL_REGION_EXPECTED_COVERAGE,
      },
      null,
      2,
    )}\n`,
  );
  if (!apply) {
    process.stdout.write('CANONICAL_WRITE=0\n');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await applyNationalRegionMaster({
      prisma,
      dump,
      confirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
      expectedConfirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
      onProgress: (progress) =>
        process.stdout.write(
          `NATIONAL_REGION_PROGRESS=${JSON.stringify(progress)}\n`,
        ),
    });
    const liveCounts = await prisma.region.groupBy({
      by: ['administrativeLevel'],
      where: { isActive: true, administrativeLevel: { not: null } },
      _count: { _all: true },
    });
    process.stdout.write(
      `${JSON.stringify({ result, liveCounts }, null, 2)}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`,
  );
  process.exitCode = 1;
});

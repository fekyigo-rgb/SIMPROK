import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { verifyE2EDatabase } from '../database-role-guards';
import {
  NATIONAL_MASTER_READY_FOR_APPLY,
  assessNationalRegionMaster,
  tryLoadNationalRegionDump,
} from '../../src/canonical-reference/region-national-master.gate';
import { planNationalRegionReuseReadOnly } from '../../src/canonical-reference/region-national-master.readonly-verifier';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

async function main(): Promise<void> {
  await verifyE2EDatabase();
  const dump = tryLoadNationalRegionDump(REPO_ROOT);
  const assessment = assessNationalRegionMaster(dump);
  if (
    !dump ||
    assessment.status !== 'READY_FOR_APPLY' ||
    assessment.reasonCode !== NATIONAL_MASTER_READY_FOR_APPLY ||
    !assessment.nationalMasterComplete
  ) {
    throw new Error(
      `STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE:${assessment.reasonCode}`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const rows = await tx.region.findMany({
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            parentId: true,
            administrativeLevel: true,
          },
        });
        const report = await planNationalRegionReuseReadOnly({
          designations: assessment.designations,
          rows,
        });
        const readOnly = await tx.$queryRawUnsafe<
          Array<{ transaction_read_only: string }>
        >('SHOW transaction_read_only');
        return {
          transactionReadOnly: readOnly[0]?.transaction_read_only ?? 'unknown',
          regionSnapshotCount: rows.length,
          designationCount: assessment.designations.length,
          ...report,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    process.stdout.write('IDEMPOTENCY_PROOF_METHOD=READ_ONLY_EXISTING_PLANNER\n');
    process.stdout.write(`TRANSACTION_READ_ONLY=${result.transactionReadOnly}\n`);
    process.stdout.write(`REGION_SNAPSHOT_COUNT=${result.regionSnapshotCount}\n`);
    process.stdout.write(`DESIGNATION_COUNT=${result.designationCount}\n`);
    process.stdout.write(`PLANNED_CREATE=${result.plannedCreate}\n`);
    process.stdout.write(`PLANNED_REUSE=${result.plannedReuse}\n`);
    process.stdout.write(`PLANNED_CONFLICT=${result.plannedConflict}\n`);
    process.stdout.write(
      `CONFLICT_REASON_COUNTS=${JSON.stringify(result.conflictReasonCounts)}\n`,
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

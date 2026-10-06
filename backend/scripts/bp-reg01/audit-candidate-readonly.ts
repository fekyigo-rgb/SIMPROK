import { Prisma, PrismaClient } from '@prisma/client';
import { WorkspacePermissionResolverService } from '../../src/auth/workspace-permission-resolver.service';
import { verifyE2EDatabase } from '../database-role-guards';

const ACTOR_EMAIL = 'assigned@test.local';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000004';

type CountRow = { count: bigint };

async function main(): Promise<void> {
  await verifyE2EDatabase();
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const resolver = new WorkspacePermissionResolverService(tx as never);
        const account = await tx.account.findUnique({
          where: { email: ACTOR_EMAIL },
          select: { id: true, status: true },
        });
        const membership = account
          ? await tx.workspaceMembership.findUnique({
              where: {
                accountId_workspaceId: {
                  accountId: account.id,
                  workspaceId: WORKSPACE_ID,
                },
              },
              select: { id: true, status: true },
            })
          : null;
        const effective = account
          ? await resolver.resolveWithinTransaction(
              tx,
              account.id,
              WORKSPACE_ID,
            )
          : null;
        const [regionTotal, duplicateCodes, missingParents, illegalParents] =
          await Promise.all([
            tx.region.count(),
            tx.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::bigint AS count
              FROM (
                SELECT code FROM regions GROUP BY code HAVING COUNT(*) > 1
              ) duplicates
            `,
            tx.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::bigint AS count
              FROM regions child
              LEFT JOIN regions parent ON parent.id = child."parentId"
              WHERE child."administrativeLevel" <> 'COUNTRY'
                AND (child."parentId" IS NULL OR parent.id IS NULL)
            `,
            tx.$queryRaw<CountRow[]>`
              SELECT COUNT(*)::bigint AS count
              FROM regions child
              JOIN regions parent ON parent.id = child."parentId"
              WHERE CASE child."administrativeLevel"::text
                WHEN 'PROVINCE' THEN parent."administrativeLevel"::text <> 'COUNTRY'
                WHEN 'REGENCY_CITY' THEN parent."administrativeLevel"::text <> 'PROVINCE'
                WHEN 'DISTRICT' THEN parent."administrativeLevel"::text <> 'REGENCY_CITY'
                WHEN 'VILLAGE' THEN parent."administrativeLevel"::text <> 'DISTRICT'
                ELSE child."administrativeLevel"::text <> 'COUNTRY'
              END
            `,
          ]);
        const kogekotu = await tx.region.findMany({
          where: { code: { in: ['94.03.01.2011', '94.03.01.2018'] } },
          select: {
            code: true,
            name: true,
            isActive: true,
            parent: { select: { code: true, name: true } },
          },
          orderBy: { code: 'asc' },
        });
        const readOnly = await tx.$queryRawUnsafe<
          Array<{ transaction_read_only: string }>
        >('SHOW transaction_read_only');
        return {
          transactionReadOnly: readOnly[0]?.transaction_read_only ?? 'unknown',
          regionTotal,
          duplicateCodeCount: Number(duplicateCodes[0]?.count ?? -1n),
          missingParentCount: Number(missingParents[0]?.count ?? -1n),
          illegalParentLevelCount: Number(illegalParents[0]?.count ?? -1n),
          kogekotu,
          accountStatus: account?.status ?? 'MISSING',
          membershipStatus: membership?.status ?? 'MISSING',
          membershipId: membership?.id ?? 'MISSING',
          effectivePermissions: effective?.permissions ?? [],
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    process.stdout.write(`TRANSACTION_READ_ONLY=${result.transactionReadOnly}\n`);
    process.stdout.write(`REGION_TOTAL=${result.regionTotal}\n`);
    process.stdout.write(
      `DUPLICATE_CODE_COUNT=${result.duplicateCodeCount}\n`,
    );
    process.stdout.write(`MISSING_PARENT_COUNT=${result.missingParentCount}\n`);
    process.stdout.write(
      `ILLEGAL_PARENT_LEVEL_COUNT=${result.illegalParentLevelCount}\n`,
    );
    for (const region of result.kogekotu) {
      process.stdout.write(
        `KOGEKOTU=${region.code}|${region.name}|active=${region.isActive}|parent=${region.parent?.code}:${region.parent?.name}\n`,
      );
    }
    process.stdout.write(`ACTOR=${ACTOR_EMAIL}\n`);
    process.stdout.write(`WORKSPACE=${WORKSPACE_ID}\n`);
    process.stdout.write(`ACCOUNT_STATUS=${result.accountStatus}\n`);
    process.stdout.write(`MEMBERSHIP_STATUS=${result.membershipStatus}\n`);
    process.stdout.write(`MEMBERSHIP_ID=${result.membershipId}\n`);
    process.stdout.write(
      `EFFECTIVE_PERMISSIONS=${result.effectivePermissions.join(',')}\n`,
    );
    process.stdout.write(
      `BASIC_PRICE_IMPORT_ACTIVE=${result.effectivePermissions.includes('BASIC_PRICE_IMPORT')}\n`,
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

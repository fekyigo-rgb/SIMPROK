import { createHash } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

import {
  createLockedE2EDatabaseClient,
  releaseE2EDatabaseLock,
  resetAndSeedE2EDatabase,
} from './e2e-database-lifecycle';
import { loadE2EEnvironment } from './database-role-guards';
import {
  cleanupGate2aPositiveFixture,
  createGate2aPositiveFixture,
  Gate2aPositiveFixture,
  PRODUCTIZATION_D_BROWSER_CREDENTIAL_SOURCE,
  PRODUCTIZATION_D_CALCULATION_DATE,
} from '../test/support/gate2a-productization-d.fixture';

type Mode = 'smoke' | 'serve';

interface CompleteDatabaseFingerprint {
  sha256: string;
  tableCount: number;
  tableRows: Record<string, number>;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function captureCompleteDatabaseFingerprint(
  client: Client,
): Promise<CompleteDatabaseFingerprint> {
  const tables = await client.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> '_prisma_migrations'
    order by table_name
  `);
  const hash = createHash('sha256');
  const tableRows: Record<string, number> = {};

  for (const { table_name: table } of tables.rows) {
    const rows = await client.query<{ canonical_row: string }>(`
      select row_to_json(t)::text as canonical_row
      from ${quoteIdentifier(table)} t
      order by row_to_json(t)::text
    `);
    tableRows[table] = rows.rowCount ?? rows.rows.length;
    hash.update(`${JSON.stringify(table)}\n`, 'utf8');
    for (const row of rows.rows) {
      hash.update(`${row.canonical_row}\n`, 'utf8');
    }
  }

  return {
    sha256: hash.digest('hex'),
    tableCount: tables.rows.length,
    tableRows,
  };
}

function sanitizedManifest(fixture: Gate2aPositiveFixture) {
  return {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    boqStructureId: fixture.boqStructureId,
    boqItemId: fixture.boqItemId,
    ahspVersionId: fixture.ahspVersionId,
    occurrenceId: fixture.occurrenceId,
    basicPriceId: fixture.basicPriceId,
    calculationDate: PRODUCTIZATION_D_CALCULATION_DATE,
    browserActorEmail: fixture.browserActorEmail,
    browserCredentialSource: PRODUCTIZATION_D_BROWSER_CREDENTIAL_SOURCE,
  };
}

async function assertFixture(
  prisma: PrismaClient,
  fixture: Gate2aPositiveFixture,
): Promise<void> {
  const item = await prisma.boqItem.findUniqueOrThrow({
    where: { id: fixture.boqItemId },
  });
  const workItemCount = await prisma.boqItem.count({
    where: {
      boqStructureId: fixture.boqStructureId,
      itemType: 'WORK_ITEM',
    },
  });
  const occurrenceCount = await prisma.projectAhspOccurrence.count({
    where: { projectId: fixture.projectId },
  });
  const resolutionCount = await prisma.projectAhspResourceResolution.count({
    where: { occurrenceId: fixture.occurrenceId, status: 'RESOLVED' },
  });
  const basicPrice = await prisma.basicPrice.findUniqueOrThrow({
    where: { id: fixture.basicPriceId },
  });
  const publication = await prisma.basicPricePublicationAudit.findFirstOrThrow({
    where: { basicPriceId: fixture.basicPriceId, action: 'PUBLISH' },
  });
  const decision = await prisma.priceSubmissionReviewDecision.findFirstOrThrow({
    where: { reviewId: fixture.reviewId, action: 'ACCEPT' },
  });
  const verifier = await prisma.user.findUniqueOrThrow({
    where: { id: decision.decidedByUserId },
    include: { membership: true },
  });

  const failures = [
    workItemCount === 1,
    occurrenceCount === 1,
    resolutionCount === 1,
    item.quantity.toString() === '5',
    item.unit === 'Kg',
    item.unitPrice === null,
    item.lineTotal === null,
    item.priceOrigin === null,
    item.calculationOccurrenceId === null,
    item.calculationAsOfDate === null,
    item.calculatedAt === null,
    item.calculationPolicyVersion === null,
    item.ahspVersionId === fixture.ahspVersionId,
    basicPrice.value.toFixed(2) === '100000.00',
    basicPrice.status === 'PUBLISHED',
    basicPrice.verificationStatus === 'PUBLISHED',
    verifier.membership.accountId !== publication.actorAccountId,
  ];
  if (failures.some((passed) => !passed)) {
    throw new Error('Productization D fixture assertion failed');
  }
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

async function main(): Promise<void> {
  const requestedMode = process.argv[2];
  if (requestedMode !== 'smoke' && requestedMode !== 'serve') {
    throw new Error('Usage: productization-d-browser-proof.ts <smoke|serve>');
  }
  const mode: Mode = requestedMode;

  loadE2EEnvironment();
  const lockedClient = await createLockedE2EDatabaseClient();
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  let fixture: Gate2aPositiveFixture | undefined;
  let baseline: CompleteDatabaseFingerprint | undefined;
  let completedNormally = false;

  try {
    await resetAndSeedE2EDatabase(lockedClient.destructiveAuthority);
    baseline = await captureCompleteDatabaseFingerprint(lockedClient);

    // AppModule is intentionally loaded only after .env.e2e has been loaded
    // and live-verified. A top-level import could let ConfigModule observe a
    // different environment before the database guard runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: 'http://localhost:5173', credentials: true });
    await app.listen(3000, '127.0.0.1');

    prisma = new PrismaClient();
    fixture = await createGate2aPositiveFixture({
      prisma,
      app,
      tag: 'PRODUCTIZATIOND',
    });
    await assertFixture(prisma, fixture);
    process.stdout.write(
      `${JSON.stringify(sanitizedManifest(fixture), null, 2)}\n`,
    );

    if (mode === 'serve') {
      process.stdout.write('PRODUCTIZATION_D_HARNESS=READY\n');
      await waitForShutdown();
    }
    completedNormally = true;
  } finally {
    let cleanupError: unknown;
    if (completedNormally && prisma && fixture) {
      try {
        await cleanupGate2aPositiveFixture(prisma, fixture);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();

    let residualError: unknown;
    if (completedNormally && baseline && !cleanupError) {
      const finalFingerprint =
        await captureCompleteDatabaseFingerprint(lockedClient);
      if (baseline.sha256 !== finalFingerprint.sha256) {
        residualError = new Error(
          `Residual mismatch: baseline=${baseline.sha256} final=${finalFingerprint.sha256}`,
        );
      } else {
        process.stdout.write(
          `CLEANUP_RESIDUAL=PASS SHA256=${finalFingerprint.sha256} TABLES=${finalFingerprint.tableCount}\n`,
        );
      }
    }

    await releaseE2EDatabaseLock(lockedClient);
    await lockedClient.end();
    if (cleanupError) throw cleanupError;
    if (residualError) throw residualError;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`PRODUCTIZATION_D_HARNESS=FAIL ${message}`);
  process.exitCode = 1;
});

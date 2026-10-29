/**
 * RAB-AUTO-07: guarded real Postgres/HTTP E2E without affecting permanent DB.
 * Reuses official DB authority, lock, fingerprints, and Jest runner.
 */
import { Client } from 'pg';
import { loadE2EEnvironment, verifyE2EDatabase } from '../database-role-guards';
import {
  acquireE2EDatabaseLock,
  releaseE2EDatabaseLock,
  captureDatabaseFingerprint,
  compareDatabaseFingerprints,
  runCommand,
} from '../e2e-database-lifecycle';
import { assertRabIsolatedDatabaseTarget } from '../../src/project-ahsp/rab-auto-07-isolated-db-target';

const SUITES: Record<string, string> = {
  boq: 'test/acceptance/boq-import.e2e-spec.ts',
  ahsp: 'test/acceptance/project-ahsp-occurrence.e2e-spec.ts',
  cost: 'test/acceptance/gate2a-rab-kernel-persistence.e2e-spec.ts',
  first: 'test/acceptance/rab-auto07-first-binding.e2e-spec.ts',
};

async function run() {
  const names = process.argv.slice(2);
  if (names.length === 0 || names.some((name) => !SUITES[name])) {
    throw new Error('RAB_E2E_SUITE_ALLOWLIST_REQUIRED');
  }
  loadE2EEnvironment();
  const uri = process.env.DATABASE_URL;
  assertRabIsolatedDatabaseTarget(uri ?? '');
  await verifyE2EDatabase();
  const client = new Client({
    connectionString: uri,
    connectionTimeoutMillis: 5_000,
    application_name: 'rab_auto07_verified_e2e_runner',
  });
  await client.connect();
  let locked = false;
  let baseline:
    | Awaited<ReturnType<typeof captureDatabaseFingerprint>>
    | undefined;
  let jestStatus = -1;
  try {
    await client.query('BEGIN READ ONLY');
    const r = await client.query<{
      db: string;
      addr: string;
      port: number;
      actor: string;
    }>(`SELECT current_database() db, inet_server_addr()::text addr,
               inet_server_port() port, current_user actor`);
    await client.query('ROLLBACK');
    const row = r.rows[0];
    if (
      row?.db !== 'simprok_e2e' ||
      !['127.0.0.1', '127.0.0.1/32'].includes(row?.addr) ||
      row.port !== 56543 ||
      row.actor !== 'simprok_rab_test_admin'
    ) {
      throw new Error('RAB_E2E_PHYSICAL_DESTINATION_NOT_VERIFIED');
    }
    await acquireE2EDatabaseLock(client);
    locked = true;
    baseline = await captureDatabaseFingerprint(client);
    console.log('RAB_E2E_VERIFIED_BASELINE_TABLES=' + baseline.length);
    jestStatus = await runCommand(process.execPath, [
      'node_modules/jest/bin/jest.js',
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      '--runTestsByPath',
      ...names.map((name) => SUITES[name]),
    ]);
    const after = await captureDatabaseFingerprint(client);
    const differences = compareDatabaseFingerprints(baseline, after);
    console.log('RAB_E2E_JEST_STATUS=' + (jestStatus === 0 ? 'PASS' : 'FAIL'));
    console.log(
      'RAB_E2E_RESIDUAL_STATUS=' + (differences.length === 0 ? 'PASS' : 'FAIL'),
    );
    if (differences.length > 0) {
      console.log(
        'RAB_E2E_RESIDUAL_TABLE_NAMES=' +
          differences
            .map((x) => x.table)
            .slice(0, 15)
            .join(','),
      );
    }
    if (jestStatus !== 0 || differences.length !== 0) {
      process.exitCode = 1;
    }
  } finally {
    if (locked) await releaseE2EDatabaseLock(client);
    await client.end();
  }
}
void run().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : '';
  // Do not echo errors originating in the DB driver / URL parser.
  console.error(msg.startsWith('RAB_E2E_') ? msg : 'RAB_E2E_RUNNER_FAILED');
  process.exitCode = 1;
});

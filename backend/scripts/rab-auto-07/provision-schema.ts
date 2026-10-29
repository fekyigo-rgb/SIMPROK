/**
 * RAB-AUTO-07: verified, TEST-ONLY database initialization.
 * Reuses the project's official E2E reset/migration+seed procedure.
 * Requires independent read-only identity proof before any write.
 */
import { verifyE2EDatabase, loadE2EEnvironment } from '../database-role-guards';
import { resetAndSeedE2EDatabase } from '../e2e-database-lifecycle';
import { assertRabIsolatedDatabaseTarget } from '../../src/project-ahsp/rab-auto-07-isolated-db-target';
import { Client } from 'pg';

async function run() {
  loadE2EEnvironment();
  const uri = process.env.DATABASE_URL;
  assertRabIsolatedDatabaseTarget(uri ?? '');
  const authorized = await verifyE2EDatabase();
  // Re-verify physical server host/port and account, not only database name.
  const client = new Client({
    connectionString: uri,
    connectionTimeoutMillis: 4000,
    application_name: 'rab_auto07_pre_migration_readonly',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{
      db: string;
      addr: string;
      port: number;
      actor: string;
    }>(`SELECT current_database() db, inet_server_addr()::text addr,
               inet_server_port() port, current_user actor`);
    const row = result.rows[0];
    if (
      row?.db !== 'simprok_e2e' ||
      !['127.0.0.1', '127.0.0.1/32'].includes(row.addr) ||
      row.port !== 56543 ||
      row.actor !== 'simprok_rab_test_admin'
    ) {
      throw new Error('RAB_E2E_PHYSICAL_DESTINATION_NOT_VERIFIED');
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
  console.log('ISOLATED_E2E_MIGRATION_GATE_PASS');
  await resetAndSeedE2EDatabase(authorized);
  console.log('ISOLATED_E2E_OFFICIAL_RESET_AND_SEED_PASS');
}
void run().catch((error: unknown) => {
  // Preserve code only: do not echo exceptions or credentials from PG.
  const msg = error instanceof Error ? error.message : '';
  console.error(
    /^RAB_E2E_/.test(msg) ? msg : 'ISOLATED_E2E_RESET_OR_SEED_FAILED',
  );
  process.exitCode = 1;
});

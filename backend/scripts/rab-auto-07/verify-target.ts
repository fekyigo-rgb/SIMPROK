/**
 * NON-MUTATING preflight for the next REAL RAB E2E.
 * Requires existing repository .env.e2e law and independently isolated
 * 127.0.0.1:56543/simprok_e2e destination.
 * Never prints a connection string, credential, or password.
 */
import { Client } from 'pg';
import {
  assertE2EEnvironment,
  E2E_DESTRUCTIVE_CAPABILITY_ENV,
  loadE2EEnvironment,
} from '../database-role-guards';
import { assertRabIsolatedDatabaseTarget } from '../../src/project-ahsp/rab-auto-07-isolated-db-target';

async function main() {
  loadE2EEnvironment();
  const connectionString = process.env.DATABASE_URL;
  assertE2EEnvironment({
    databaseUrl: connectionString,
    nodeEnv: process.env.NODE_ENV,
    destructiveCapability: process.env[E2E_DESTRUCTIVE_CAPABILITY_ENV],
  });
  const expected = assertRabIsolatedDatabaseTarget(connectionString!);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 3_000,
    application_name: 'rab_auto_07_isolated_readonly_preflight',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{
      db: string;
      addr: string;
      port: number;
      actor: string;
    }>(`SELECT current_database() AS db,
                 inet_server_addr()::text AS addr,
                 inet_server_port() AS port,
                 current_user AS actor`);
    const row = result.rows[0];
    // PostgreSQL inet::text may show its precise IPv4 mask as 127.0.0.1/32.
    // Only this exact loopback CIDR is accepted, not arbitrary subnets.
    const validLoopbackHost =
      row?.addr === expected.host || row?.addr === `${expected.host}/32`;
    if (
      row?.db !== expected.database ||
      !validLoopbackHost ||
      row.port !== expected.port ||
      row.actor !== expected.actor
    ) {
      // Diagnostic flags only; never echo DATABASE_URL or authentication data.
      console.error(
        'RAB_E2E_IDENTITY_FLAGS=' +
          JSON.stringify({
            db: row?.db === expected.database,
            host: validLoopbackHost,
            port: row?.port === expected.port,
            actor: row?.actor === expected.actor,
          }),
      );
      throw new Error('RAB_E2E_LIVE_DATABASE_IDENTITY_MISMATCH');
    }
    console.log('RAB_AUTO_07_ISOLATED_DATABASE_READONLY_PREFLIGHT_PASS');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}
void main().catch((error: unknown) => {
  const code =
    error instanceof Error && error.message.startsWith('RAB_E2E_')
      ? error.message
      : 'RAB_E2E_ENVIRONMENT_OR_CONNECTION_NOT_READY';
  // Original PG errors may include confidential URLs, never print them.
  console.error(code);
  process.exitCode = 1;
});

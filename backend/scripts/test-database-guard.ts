import { Client } from 'pg';

import { loadTestEnv } from '../test/load-test-env';

export const EXPECTED_TEST_DATABASE = 'simprok_test';
export const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db';
export const DESTRUCTIVE_CAPABILITY_ENV =
  'SIMPROK_E2E_DESTRUCTIVE_CAPABILITY';
export const DESTRUCTIVE_CAPABILITY = 'RESET_SIMPROK_TEST_DATABASE';

type QueryResult<Row> = { rows: Row[] };

export interface DatabaseNameClient {
  query<Row extends Record<string, unknown>>(sql: string): Promise<QueryResult<Row>>;
}

export interface TestDatabaseEnvironment {
  databaseUrl?: string;
  nodeEnv?: string;
  destructiveCapability?: string;
}

export function databaseNameFromUrl(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must contain exactly one database name');
  }

  return databaseName;
}

export function assertSafeTestDatabaseEnvironment(
  environment: TestDatabaseEnvironment,
): string {
  if (environment.nodeEnv !== 'test') {
    throw new Error('NODE_ENV must be exactly test');
  }

  if (!environment.databaseUrl) {
    throw new Error('DATABASE_URL is missing after loading .env.test');
  }

  const databaseName = databaseNameFromUrl(environment.databaseUrl);

  if (databaseName === FORBIDDEN_PRODUCTION_DATABASE) {
    throw new Error(
      `DATABASE_URL points to forbidden database ${FORBIDDEN_PRODUCTION_DATABASE}`,
    );
  }

  if (databaseName !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `DATABASE_URL database must be exactly ${EXPECTED_TEST_DATABASE}, got ${databaseName}`,
    );
  }

  if (environment.destructiveCapability !== DESTRUCTIVE_CAPABILITY) {
    throw new Error(
      `${DESTRUCTIVE_CAPABILITY_ENV} must explicitly authorize ${EXPECTED_TEST_DATABASE}`,
    );
  }

  return databaseName;
}

export function assertLiveDatabaseName(currentDatabase: string | undefined): void {
  if (currentDatabase === FORBIDDEN_PRODUCTION_DATABASE) {
    throw new Error(
      `current_database() returned forbidden database ${FORBIDDEN_PRODUCTION_DATABASE}`,
    );
  }

  if (currentDatabase !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `expected current_database() = ${EXPECTED_TEST_DATABASE}, got ${currentDatabase ?? 'undefined'}`,
    );
  }
}

export async function verifyTestDatabase(
  existingClient?: DatabaseNameClient,
): Promise<void> {
  loadTestEnv();

  const databaseUrl = process.env.DATABASE_URL;
  assertSafeTestDatabaseEnvironment({
    databaseUrl,
    nodeEnv: process.env.NODE_ENV,
    destructiveCapability: process.env[DESTRUCTIVE_CAPABILITY_ENV],
  });

  const ownedClient = existingClient ? undefined : new Client({ connectionString: databaseUrl });
  const client = existingClient ?? ownedClient;

  if (!client) {
    throw new Error('Database guard could not create a database client');
  }

  if (ownedClient) {
    await ownedClient.connect();
  }

  try {
    const result = await client.query<{ current_database: string }>(
      'select current_database() as current_database',
    );
    const currentDatabase = result.rows[0]?.current_database;
    assertLiveDatabaseName(currentDatabase);
    console.log(`Database guard PASS: URL and live database = ${currentDatabase}`);
  } finally {
    if (ownedClient) {
      await ownedClient.end();
    }
  }
}

if (require.main === module) {
  verifyTestDatabase().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Database guard FAIL: ${message}`);
    process.exitCode = 1;
  });
}

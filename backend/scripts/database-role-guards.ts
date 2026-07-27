import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';

export const ACCEPTANCE_DATABASE = 'simprok_test';
export const E2E_DATABASE = 'simprok_e2e';
export const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db';
export const E2E_DESTRUCTIVE_CAPABILITY_ENV =
  'SIMPROK_E2E_DESTRUCTIVE_CAPABILITY';
export const E2E_DESTRUCTIVE_CAPABILITY =
  'RESET_SIMPROK_E2E_DATABASE';
export const ACCEPTANCE_ENV_PATH = resolve(__dirname, '..', '.env.test');
export const E2E_ENV_PATH = resolve(__dirname, '..', '.env.e2e');

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    return undefined;
  }
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnvironmentFile(path: string): void {
  const contents = readFileSync(path, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) {
      process.env[entry[0]] = entry[1];
    }
  }
}

export function loadAcceptanceEnvironment(): void {
  loadEnvironmentFile(ACCEPTANCE_ENV_PATH);
}

export function loadE2EEnvironment(): void {
  loadEnvironmentFile(E2E_ENV_PATH);
}

type QueryResult<Row> = { rows: Row[] };

export interface DatabaseNameClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
  ): Promise<QueryResult<Row>>;
}

export interface DatabaseEnvironment {
  databaseUrl?: string;
  nodeEnv?: string;
  destructiveCapability?: string;
}

const E2E_AUTHORITY = Symbol('verified-e2e-destructive-authority');

export interface VerifiedE2EDestructiveAuthority {
  readonly databaseName: typeof E2E_DATABASE;
  readonly [E2E_AUTHORITY]: true;
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

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL database name is not valid URL encoding');
  }

  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must contain exactly one database name');
  }

  return databaseName;
}

function assertBaseEnvironment(environment: DatabaseEnvironment): string {
  if (environment.nodeEnv !== 'test') {
    throw new Error('NODE_ENV must be exactly test');
  }
  if (!environment.databaseUrl) {
    throw new Error('DATABASE_URL is missing from the selected environment file');
  }
  return databaseNameFromUrl(environment.databaseUrl);
}

export function assertAcceptanceEnvironment(
  environment: DatabaseEnvironment,
): typeof ACCEPTANCE_DATABASE {
  const databaseName = assertBaseEnvironment(environment);

  if (databaseName !== ACCEPTANCE_DATABASE) {
    throw new Error(
      `Acceptance database must be exactly ${ACCEPTANCE_DATABASE}`,
    );
  }
  if (environment.destructiveCapability) {
    throw new Error('Acceptance environment must not authorize destructive reset');
  }
  return ACCEPTANCE_DATABASE;
}

export function assertE2EEnvironment(
  environment: DatabaseEnvironment,
): typeof E2E_DATABASE {
  const databaseName = assertBaseEnvironment(environment);

  if (databaseName !== E2E_DATABASE) {
    throw new Error(`E2E database must be exactly ${E2E_DATABASE}`);
  }
  if (environment.destructiveCapability !== E2E_DESTRUCTIVE_CAPABILITY) {
    throw new Error(
      `${E2E_DESTRUCTIVE_CAPABILITY_ENV} must explicitly authorize ${E2E_DATABASE}`,
    );
  }
  return E2E_DATABASE;
}

export function assertLiveDatabaseName(
  currentDatabase: string | undefined,
  expected: string,
): void {
  if (currentDatabase !== expected) {
    throw new Error(`Live database must be exactly ${expected}`);
  }
}

async function verifyDatabase(
  expected: string,
  databaseUrl: string,
  existingClient?: DatabaseNameClient,
): Promise<void> {
  const ownedClient = existingClient
    ? undefined
    : new Client({ connectionString: databaseUrl });
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
    assertLiveDatabaseName(result.rows[0]?.current_database, expected);
  } finally {
    if (ownedClient) {
      await ownedClient.end();
    }
  }
}

export async function verifyAcceptanceDatabase(
  existingClient?: DatabaseNameClient,
): Promise<void> {
  loadAcceptanceEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  assertAcceptanceEnvironment({
    databaseUrl,
    nodeEnv: process.env.NODE_ENV,
    destructiveCapability: process.env[E2E_DESTRUCTIVE_CAPABILITY_ENV],
  });
  await verifyDatabase(ACCEPTANCE_DATABASE, databaseUrl!, existingClient);
  console.log(`Acceptance database guard PASS: ${ACCEPTANCE_DATABASE}`);
}

export async function verifyE2EDatabase(
  existingClient?: DatabaseNameClient,
): Promise<VerifiedE2EDestructiveAuthority> {
  loadE2EEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  assertE2EEnvironment({
    databaseUrl,
    nodeEnv: process.env.NODE_ENV,
    destructiveCapability: process.env[E2E_DESTRUCTIVE_CAPABILITY_ENV],
  });
  await verifyDatabase(E2E_DATABASE, databaseUrl!, existingClient);
  console.log(`E2E database guard PASS: ${E2E_DATABASE}`);
  return {
    databaseName: E2E_DATABASE,
    [E2E_AUTHORITY]: true,
  };
}

export function assertVerifiedE2EAuthority(
  authority: VerifiedE2EDestructiveAuthority,
): void {
  if (
    authority?.databaseName !== E2E_DATABASE ||
    authority[E2E_AUTHORITY] !== true
  ) {
    throw new Error('Verified E2E destructive authority is required');
  }
}

async function main(): Promise<void> {
  const role = process.argv[2];
  if (role === 'acceptance') {
    await verifyAcceptanceDatabase();
    return;
  }
  if (role === 'e2e') {
    await verifyE2EDatabase();
    return;
  }
  throw new Error('Use an explicit database role: acceptance or e2e');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Database role guard FAIL: ${message}`);
    process.exitCode = 1;
  });
}

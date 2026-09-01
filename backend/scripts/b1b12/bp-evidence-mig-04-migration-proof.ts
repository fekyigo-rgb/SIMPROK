/**
 * BP-EVIDENCE-MIG-04 — Prisma/migration proof.
 *
 * Never prints a DSN, user, or password. Never writes to 55432 / simprok_db.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

import { parseGovernedEnvFile } from '../../src/rehearsal/b1b12-rehearsal-environment';
import {
  assertB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
} from '../../src/rehearsal/b1b12-rehearsal-target';
import {
  PERMANENT_RUNTIME_DATABASE,
  PERMANENT_RUNTIME_HOST,
  PERMANENT_RUNTIME_PORT,
} from '../../src/runtime/permanent-runtime-target';

const BACKEND_ROOT = resolve(__dirname, '..', '..');
const PRISMA = resolve(
  BACKEND_ROOT,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const PRIVATE_OBS = '20260828120000_bp_change_sem_03_private_new_observation';
const KDN_MEANINGS =
  '20260828153000_bp_change_sem_03_kdn_establishment_meanings';
const FRESH_DB = 'simprok_bp_evid_mig04_fresh';
const TASK_MIGRATIONS = [PRIVATE_OBS, KDN_MEANINGS] as const;

function urlParts(raw: string): {
  host: string;
  port: number;
  database: string;
} {
  const parsed = new URL(raw);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

function withDatabase(raw: string, databaseName: string): string {
  const parsed = new URL(raw);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function prisma(args: string[], databaseUrl: string): string {
  return execFileSync(process.execPath, [PRISMA, ...args], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
}

async function appliedMigrations(
  connectionString: string,
): Promise<
  Array<{ migration_name: string; finished: boolean; rolledBack: boolean }>
> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM _prisma_migrations
       WHERE migration_name = ANY($1::text[])`,
      [TASK_MIGRATIONS],
    );
    const failed = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    if (Number(failed.rows[0]?.n ?? '0') > 0) {
      throw new Error('UNEXPECTED_UNFINISHED_MIGRATION');
    }
    return result.rows.map((row) => ({
      migration_name: row.migration_name,
      finished: row.finished_at !== null,
      rolledBack: row.rolled_back_at !== null,
    }));
  } finally {
    await client.end();
  }
}

function assertTaskMigrationsApplied(
  rows: Array<{
    migration_name: string;
    finished: boolean;
    rolledBack: boolean;
  }>,
  label: string,
): void {
  for (const name of TASK_MIGRATIONS) {
    const row = rows.find((item) => item.migration_name === name);
    if (!row) throw new Error(`${label}_MISSING_${name}`);
    if (!row.finished) throw new Error(`${label}_UNFINISHED_${name}`);
    if (row.rolledBack) throw new Error(`${label}_ROLLED_BACK_${name}`);
  }
}

async function dropIfExists(
  adminUrl: string,
  databaseName: string,
): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await client.end();
  }
}

async function rehearsalStatus(): Promise<void> {
  const governed = parseGovernedEnvFile(
    readFileSync(
      'C:/Users/asus/SIMPROK-RUNTIME/secrets/b1b12.migrator.env',
      'utf8',
    ),
  );
  const databaseUrl = governed.get('DATABASE_URL');
  if (!databaseUrl) throw new Error('REHEARSAL_DSN_MISSING');
  const target = parseRehearsalTargetFromUrl(databaseUrl);
  assertB1B12RehearsalTarget(target);
  const status = prisma(['migrate', 'status'], databaseUrl);
  const pending = /Following migrations have not yet been applied/u.test(
    status,
  );
  const applied = await appliedMigrations(databaseUrl);
  assertTaskMigrationsApplied(applied, 'REHEARSAL');
  console.log(
    `REHEARSAL_TARGET=${target.host}:${target.port}/${target.databaseName}`,
  );
  console.log(`REHEARSAL_HAS_${PRIVATE_OBS}=YES`);
  console.log(`REHEARSAL_HAS_${KDN_MEANINGS}=YES`);
  console.log(`REHEARSAL_PENDING=${pending ? 'YES' : 'NO'}`);
  if (pending) {
    throw new Error('REHEARSAL_MIGRATION_PENDING');
  }
  console.log('REHEARSAL_55433_MIGRATION_STATE=PASS');
}

async function freshChain(): Promise<void> {
  const testEnv = parseGovernedEnvFile(
    readFileSync(resolve(BACKEND_ROOT, '.env.test'), 'utf8'),
  );
  const adminUrl = testEnv.get('DATABASE_URL');
  if (!adminUrl) throw new Error('FRESH_CHAIN_DSN_MISSING');
  const admin = urlParts(adminUrl);
  if (
    admin.port === PERMANENT_RUNTIME_PORT ||
    admin.database === PERMANENT_RUNTIME_DATABASE
  ) {
    throw new Error('FRESH_CHAIN_REFUSED_CANONICAL');
  }
  await dropIfExists(adminUrl, FRESH_DB);
  const creator = new Client({ connectionString: adminUrl });
  await creator.connect();
  try {
    await creator.query(`CREATE DATABASE ${FRESH_DB}`);
  } finally {
    await creator.end();
  }

  const freshUrl = withDatabase(adminUrl, FRESH_DB);
  const freshParts = urlParts(freshUrl);
  if (freshParts.port === PERMANENT_RUNTIME_PORT) {
    throw new Error('FRESH_CHAIN_REFUSED_CANONICAL_PORT');
  }
  console.log(
    `FRESH_TARGET=${freshParts.host}:${freshParts.port}/${freshParts.database}`,
  );
  const deploy = prisma(['migrate', 'deploy'], freshUrl);
  console.log(deploy.trim());
  const applied = await appliedMigrations(freshUrl);
  assertTaskMigrationsApplied(applied, 'FRESH');
  const status = prisma(['migrate', 'status'], freshUrl);
  if (/Following migrations have not yet been applied/u.test(status)) {
    throw new Error('FRESH_CHAIN_PENDING');
  }
  console.log('FRESH_DB_MIGRATION_CHAIN=PASS');
  console.log('PRIVATE_NEW_OBSERVATION_MIGRATION=PASS');
  console.log('KDN_ESTABLISHMENT_MIGRATION=PASS');
  await dropIfExists(adminUrl, FRESH_DB);
}

async function canonicalReadOnly(): Promise<void> {
  const governed = parseGovernedEnvFile(
    readFileSync(
      'C:/Users/asus/SIMPROK-RUNTIME/secrets/backend.runtime.env',
      'utf8',
    ),
  );
  const databaseUrl = governed.get('DATABASE_URL');
  if (!databaseUrl) throw new Error('CANONICAL_DSN_MISSING');
  const parts = urlParts(databaseUrl);
  console.log(`CANONICAL_PROBE=${parts.host}:${parts.port}/${parts.database}`);
  if (
    parts.host !== PERMANENT_RUNTIME_HOST ||
    parts.port !== PERMANENT_RUNTIME_PORT ||
    parts.database !== PERMANENT_RUNTIME_DATABASE
  ) {
    throw new Error('CANONICAL_PROBE_NOT_CANONICAL_COORDINATES');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations
       WHERE migration_name = ANY($1::text[])`,
      [TASK_MIGRATIONS],
    );
    console.log(`CANONICAL_TASK_MIGRATION_ROWS=${result.rowCount ?? 0}`);
    if ((result.rowCount ?? 0) !== 0) {
      throw new Error('CANONICAL_55432_MIGRATION_APPLIED');
    }
  } finally {
    await client.end();
  }
  console.log('CANONICAL_55432_MIGRATION_APPLIED=NO');
}

async function main(): Promise<void> {
  await rehearsalStatus();
  await freshChain();
  await canonicalReadOnly();
  console.log('MIGRATION_PROOF=PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown';
  console.error(`MIGRATION_PROOF_FAIL=${message}`);
  process.exit(1);
});

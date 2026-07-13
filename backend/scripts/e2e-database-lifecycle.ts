import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { Client } from 'pg';

import { verifyTestDatabase } from './test-database-guard';

const ADVISORY_LOCK_KEY = 1_397_314_336;
const VOLATILE_DATA_TYPES = [
  'date',
  'time without time zone',
  'time with time zone',
  'timestamp without time zone',
  'timestamp with time zone',
];

export interface TableFingerprint {
  table: string;
  rowCount: number;
  digest: string;
}

export interface FingerprintDifference {
  table: string;
  baseline?: TableFingerprint;
  final?: TableFingerprint;
}

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
}

interface FingerprintRow {
  row_count: string;
  digest: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function acquireE2EDatabaseLock(client: Client): Promise<void> {
  await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  console.log('E2E database advisory lock acquired');
}

export async function releaseE2EDatabaseLock(client: Client): Promise<void> {
  await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  console.log('E2E database advisory lock released');
}

export function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

async function requireSuccessfulCommand(
  label: string,
  command: string,
  args: string[],
): Promise<void> {
  const exitCode = await runCommand(command, args);
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

export async function resetAndSeedTestDatabase(): Promise<void> {
  await requireSuccessfulCommand('Prisma migration reset', process.execPath, [
    'node_modules/prisma/build/index.js',
    'migrate',
    'reset',
    '--force',
    '--skip-seed',
  ]);

  await requireSuccessfulCommand('Acceptance seed', process.execPath, [
    'node_modules/ts-node/dist/bin.js',
    'prisma/seed-acceptance.ts',
  ]);
}

export async function captureDatabaseFingerprint(
  client: Client,
): Promise<TableFingerprint[]> {
  const tables = await client.query<TableRow>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> '_prisma_migrations'
    order by table_name
  `);

  const fingerprints: TableFingerprint[] = [];

  for (const { table_name: table } of tables.rows) {
    const columns = await client.query<ColumnRow>(
      `
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position
      `,
      [table],
    );
    const stableColumns = columns.rows
      .filter((column) => !VOLATILE_DATA_TYPES.includes(column.data_type))
      .map((column) => column.column_name);

    const rowExpression = stableColumns.length
      ? `jsonb_build_array(${stableColumns
          .map((column) => `t.${quoteIdentifier(column)}`)
          .join(', ')})::text`
      : `'[]'::text`;
    const tableIdentifier = quoteIdentifier(table);
    const result = await client.query<FingerprintRow>(`
      select
        count(*)::text as row_count,
        coalesce(md5(string_agg(stable_row, E'\\n' order by stable_row)), md5('')) as digest
      from (
        select ${rowExpression} as stable_row
        from ${tableIdentifier} t
      ) stable_rows
    `);
    const fingerprint = result.rows[0];

    fingerprints.push({
      table,
      rowCount: Number(fingerprint?.row_count ?? 0),
      digest: fingerprint?.digest ?? '',
    });
  }

  return fingerprints;
}

export function compareDatabaseFingerprints(
  baseline: TableFingerprint[],
  final: TableFingerprint[],
): FingerprintDifference[] {
  const baselineByTable = new Map(baseline.map((entry) => [entry.table, entry]));
  const finalByTable = new Map(final.map((entry) => [entry.table, entry]));
  const tables = [...new Set([...baselineByTable.keys(), ...finalByTable.keys()])].sort();

  return tables.flatMap((table) => {
    const baselineEntry = baselineByTable.get(table);
    const finalEntry = finalByTable.get(table);
    if (
      baselineEntry?.rowCount === finalEntry?.rowCount &&
      baselineEntry?.digest === finalEntry?.digest
    ) {
      return [];
    }

    return [{ table, baseline: baselineEntry, final: finalEntry }];
  });
}

export async function createLockedDatabaseClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await verifyTestDatabase(client);
    await acquireE2EDatabaseLock(client);
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

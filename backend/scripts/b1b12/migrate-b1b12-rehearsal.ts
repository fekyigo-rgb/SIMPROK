/**
 * B1B12 — bring the rehearsal database up to the repository's OFFICIAL
 * migration state, under the same guard that protects every other rehearsal
 * action.
 *
 * WHY THIS EXISTS. The rehearsal database was created on 2026-08-13 and the
 * repository has moved since. The Owner's browser upload answered 500 for one
 * reason: Prisma P2022, `basic_price_import_batches.sourceLocatorDialect does
 * not exist in the current database` — the USI-01 migration that HEAD already
 * carries had never been applied to the rehearsal cluster. Nothing was wrong
 * with the workbook, the parser or the code; the environment was simply behind
 * the code it was asked to run. The two existing wrappers here can start the
 * backend and re-seed the fixture, and neither can close that gap.
 *
 * IT AUTHORS NOTHING. `prisma migrate deploy` applies migrations that are
 * already committed, in order, and creates none — so this can move a rehearsal
 * environment forward to the repository, and can never move the repository.
 *
 * THIN BY DESIGN, exactly like its two siblings: read the governed env file,
 * ask `src/rehearsal/b1b12-rehearsal-target.ts` whether the target is a
 * rehearsal database at all, move the value into a CHILD environment, spawn.
 * It states no database law of its own, so there is still exactly ONE
 * definition of a valid rehearsal target, covered by the standard `npm test`
 * gate.
 *
 * IT USES THE MIGRATOR ENVIRONMENT, not the backend one. Applying DDL is the
 * migrator role's work and no one else's; the runtime's application role has
 * deliberately never held that authority. That file declares a DSN and nothing
 * else, so the worker-flag and topology clauses of the backend contract do not
 * apply to it — the clause that does apply, and the only one that protects the
 * Permanent cluster, is the target guard, which is asserted below.
 *
 * SECRET DISCIPLINE: the DSN is parsed and discarded. Only the host, port and
 * database name are ever printed.
 *
 *   npm run b1b12:migrate:rehearsal
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseGovernedEnvFile } from '../../src/rehearsal/b1b12-rehearsal-environment';
import {
  assertB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
} from '../../src/rehearsal/b1b12-rehearsal-target';

const GOVERNED_ENV_FILE =
  'C:/Users/asus/SIMPROK-RUNTIME/secrets/b1b12.migrator.env';
const BACKEND_ROOT = resolve(__dirname, '..', '..');

function main(): void {
  const governed = parseGovernedEnvFile(
    readFileSync(GOVERNED_ENV_FILE, 'utf8'),
  );
  const databaseUrl = governed.get('DATABASE_URL');

  // ONE authority decides what a rehearsal database is. A DSN aimed anywhere
  // else — Permanent, legacy, remote — is refused here, before prisma is
  // spawned and therefore before a single statement is sent.
  const target = parseRehearsalTargetFromUrl(databaseUrl);
  assertB1B12RehearsalTarget(target);

  console.log(
    `GOVERNED_ENV   ${GOVERNED_ENV_FILE}\n` +
      `DB_TARGET      ${target.host}:${target.port}/${target.databaseName}\n` +
      `ACTION         prisma migrate deploy (applies committed migrations only)`,
  );

  const child = spawn(
    process.execPath,
    [
      resolve(BACKEND_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'deploy',
    ],
    {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`B1B12 MIGRATE FAIL: ${message}`);
  process.exitCode = 1;
}

/**
 * B1B12 — start the rehearsal backend under the governed environment.
 *
 * THIN BY DESIGN. Every rule this script appears to enforce actually lives in
 * src/rehearsal/: b1b12-rehearsal-environment.ts owns the governed-env
 * contract and the ambient-loses composition, and b1b12-rehearsal-target.ts
 * owns what a B1B12 rehearsal database is. Both are covered by the standard
 * `npm test` gate. What remains here is wiring: read the file, ask the law,
 * probe the port, spawn the child.
 *
 * IT EXISTS SO THE POWERSHELL LAUNCHER DOES NOT HAVE TO KNOW ANY OF IT. The
 * launcher previously carried its own copy of the database rule — a looser
 * prefix check that admitted names the provisioner refused. Two definitions of
 * "valid rehearsal target" is one too many, so the launcher now delegates here
 * and states no database law at all.
 *
 * RUNS UNDER tsx, and that is correct: this script imports two pure modules
 * and never builds the Nest container, so the decorator-metadata limitation
 * that forces the provisioner onto ts-node does not apply. The Nest
 * application is compiled by the child (`npm run start`), exactly as always.
 *
 * NO SECRET IS PRINTED. Values are moved into the child's environment; only
 * key NAMES, the database coordinates and the topology are ever reported.
 *
 *   npm run b1b12:start:backend
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

import {
  B1B12_LAUNCHER_OWNED_ENV,
  assertGovernedRehearsalContract,
  composeRehearsalChildEnvironment,
  governedKeysOf,
  parseGovernedEnvFile,
} from '../../src/rehearsal/b1b12-rehearsal-environment';
import { parseRehearsalTargetFromUrl } from '../../src/rehearsal/b1b12-rehearsal-target';
import { resolveB1B12RuntimePaths } from '../../src/rehearsal/b1b12-runtime-paths';

const {
  backendEnvFile: GOVERNED_ENV_FILE,
  rehearsalDatabaseLogFile: REHEARSAL_DATABASE_LOG_FILE,
  rehearsalPgDataDirectory: REHEARSAL_PGDATA,
} = resolveB1B12RuntimePaths();
const BACKEND_ROOT = resolve(__dirname, '..', '..');
const PG_CTL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_ctl.exe';

function reachable(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolveReachable) => {
    const socket = connect({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolveReachable(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function main(): Promise<void> {
  const governed = parseGovernedEnvFile(
    readFileSync(GOVERNED_ENV_FILE, 'utf8'),
  );

  // One call, and it decides everything: required secrets present, all four
  // background workers explicitly disabled, topology agreeing with the
  // launcher, and the database target lawful.
  assertGovernedRehearsalContract(governed);

  const target = parseRehearsalTargetFromUrl(governed.get('DATABASE_URL'));
  console.log(
    `GOVERNED_ENV      ${GOVERNED_ENV_FILE}\n` +
      `GOVERNED_KEYS     ${governedKeysOf(governed).sort().join(', ')}\n` +
      `WORKERS           all four explicitly false (contract enforced)\n` +
      `DB_TARGET         ${target.host}:${target.port}/${target.databaseName}\n` +
      `LAUNCHER_OWNED    PORT=${B1B12_LAUNCHER_OWNED_ENV.PORT} ` +
      `CORS_ORIGINS=${B1B12_LAUNCHER_OWNED_ENV.CORS_ORIGINS}`,
  );

  if (!(await reachable(target.host, target.port))) {
    console.error(
      `STOP_REHEARSAL_DB_UNREACHABLE: nothing is listening on ${target.host}:${target.port}\n` +
        'Start the rehearsal cluster first:\n' +
        `  & "${PG_CTL}" start -D "${REHEARSAL_PGDATA}" -l "${REHEARSAL_DATABASE_LOG_FILE}"`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`DB_REACHABLE      ${target.host}:${target.port}`);

  // NO SHELL, AND NO .cmd. Two Windows facts meet here: since the
  // CVE-2024-27980 fix Node refuses to spawn `npm.cmd` directly (EINVAL), and
  // the obvious workaround — `shell: true` with an args array — is itself
  // deprecated (DEP0190) precisely because arguments get concatenated rather
  // than escaped. Running npm's own JS entry point under the current Node
  // avoids both: no shell is involved, so there is nothing to escape and
  // nothing to inject.
  //
  // `npm run start` stays the single definition of how this backend starts —
  // this only changes how npm itself is invoked, never what it runs. Every
  // governed value travels in `env`, never in argv, so no secret can surface
  // in a process listing.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      'STOP_REHEARSAL_RUNNER_UNSUPPORTED: run this through `npm run b1b12:start:backend`.',
    );
  }
  const child = spawn(process.execPath, [npmCli, 'run', 'start'], {
    cwd: BACKEND_ROOT,
    env: composeRehearsalChildEnvironment({
      ambient: process.env,
      governed,
    }),
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`B1B12 BACKEND START FAIL: ${message}`);
  process.exitCode = 1;
});

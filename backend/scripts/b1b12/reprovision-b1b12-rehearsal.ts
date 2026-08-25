/**
 * B1B12 — re-run the rehearsal provisioner under the governed environment.
 *
 * WHY THIS EXISTS. The rehearsal fixture used to grant only BASIC_PRICE_VERIFY
 * and BASIC_PRICE_PUBLISH, so no actor in the rehearsal database could import a
 * price list at all: the Owner opening /basic-price/import was answered 403 by
 * PermissionsGuard before intake ever saw the workbook. The fixture is repaired
 * (`test/fixtures/b1b12-section-provisioner.ts`), but a database provisioned
 * BEFORE that repair still carries the old grants. It has to be re-provisioned
 * once for the repair to be true of the environment as well as of the code.
 *
 * THIN BY DESIGN, AND IT READS NO SECRET INTO VIEW. It does exactly what
 * `start-b1b12-rehearsal-backend.ts` already does — parse the governed env file,
 * assert the contract, move the values into a CHILD process environment — and
 * then runs the existing provisioner. No value is printed, no value reaches
 * argv, and this file states no database law of its own: the target rule lives
 * in `src/rehearsal/b1b12-rehearsal-target.ts`, which the standard `npm test`
 * gate covers and which admits exactly one host, port and database-name shape.
 *
 * IT CANNOT TOUCH THE PERMANENT DATABASE. The same guard that protects the
 * rehearsal backend protects this: a DSN that is not a B1B12 rehearsal target is
 * refused before anything is written.
 *
 *   npm run b1b12:reprovision:rehearsal
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertGovernedRehearsalContract,
  composeRehearsalChildEnvironment,
  governedKeysOf,
  parseGovernedEnvFile,
} from '../../src/rehearsal/b1b12-rehearsal-environment';
import { parseRehearsalTargetFromUrl } from '../../src/rehearsal/b1b12-rehearsal-target';

const GOVERNED_ENV_FILE =
  'C:/Users/asus/SIMPROK-RUNTIME/secrets/b1b12.backend.env';
const BACKEND_ROOT = resolve(__dirname, '..', '..');

function main(): void {
  const governed = parseGovernedEnvFile(
    readFileSync(GOVERNED_ENV_FILE, 'utf8'),
  );
  assertGovernedRehearsalContract(governed);

  const target = parseRehearsalTargetFromUrl(governed.get('DATABASE_URL'));
  console.log(
    `GOVERNED_ENV   ${GOVERNED_ENV_FILE}\n` +
      `GOVERNED_KEYS  ${governedKeysOf(governed).sort().join(', ')}\n` +
      `DB_TARGET      ${target.host}:${target.port}/${target.databaseName}\n` +
      `ACTION         re-run provisionB1B12Section (rehearsal data only)`,
  );

  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      'STOP_REHEARSAL_RUNNER_UNSUPPORTED: run this through `npm run b1b12:reprovision:rehearsal`.',
    );
  }
  const child = spawn(
    process.execPath,
    [npmCli, 'run', 'b1b12:provision:rehearsal'],
    {
      cwd: BACKEND_ROOT,
      env: composeRehearsalChildEnvironment({
        ambient: process.env,
        governed,
      }),
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
  console.error(`B1B12 REPROVISION FAIL: ${message}`);
  process.exitCode = 1;
}

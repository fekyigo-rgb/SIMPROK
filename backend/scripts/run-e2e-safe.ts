import {
  E2E_ENV_PATH,
  loadE2EEnvironment,
} from './database-role-guards';
import {
  captureDatabaseFingerprint,
  compareDatabaseFingerprints,
  createLockedE2EDatabaseClient,
  releaseE2EDatabaseLock,
  resetAndSeedE2EDatabase,
  runCommand,
  TableFingerprint,
} from './e2e-database-lifecycle';

async function main(): Promise<void> {
  loadE2EEnvironment();
  console.log(`E2E safe env loaded from ${E2E_ENV_PATH}`);

  const client = await createLockedE2EDatabaseClient();
  let baseline: TableFingerprint[] | undefined;
  let jestExitCode = 1;
  let residualExitCode = 1;
  let infrastructureError: unknown;

  try {
    await resetAndSeedE2EDatabase(client.destructiveAuthority);
    baseline = await captureDatabaseFingerprint(client);
    console.log(`E2E baseline fingerprint captured for ${baseline.length} tables`);

    jestExitCode = await runCommand(process.execPath, [
      'node_modules/jest/bin/jest.js',
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
    ]);
  } catch (error) {
    infrastructureError = error;
  } finally {
    if (baseline) {
      try {
        const finalFingerprint = await captureDatabaseFingerprint(client);
        const differences = compareDatabaseFingerprints(baseline, finalFingerprint);

        if (differences.length === 0) {
          residualExitCode = 0;
          console.log('RESIDUAL_RESULT: PASS - final database matches baseline');
        } else {
          console.error('RESIDUAL_RESULT: FAIL - database residuals detected');
          for (const difference of differences) {
            console.error(
              `  ${difference.table}: baseline=${difference.baseline?.rowCount ?? 'missing'}/${difference.baseline?.digest ?? 'missing'} final=${difference.final?.rowCount ?? 'missing'}/${difference.final?.digest ?? 'missing'}`,
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`RESIDUAL_RESULT: FAIL - ${message}`);
      }
    } else {
      console.error('RESIDUAL_RESULT: NOT_RUN - baseline was not established');
    }

    try {
      await releaseE2EDatabaseLock(client);
    } finally {
      await client.end();
    }
  }

  console.log(`JEST_RESULT: ${jestExitCode === 0 ? 'PASS' : `FAIL (${jestExitCode})`}`);

  if (infrastructureError) {
    const message =
      infrastructureError instanceof Error
        ? infrastructureError.message
        : String(infrastructureError);
    console.error(`E2E safe infrastructure FAIL: ${message}`);
  }

  process.exitCode =
    infrastructureError || jestExitCode !== 0 || residualExitCode !== 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E safe FAIL: ${message}`);
  process.exitCode = 1;
});

import { spawn } from 'node:child_process';

import { ENV_TEST_PATH, loadTestEnv } from '../test/load-test-env';
import { verifyTestDatabase } from './test-database-guard';

async function main(): Promise<void> {
  loadTestEnv();
  await verifyTestDatabase();

  console.log(`E2E safe env loaded from ${ENV_TEST_PATH}`);

  const jestProcess = spawn(
    process.execPath,
    ['node_modules/jest/bin/jest.js', '--config', './test/jest-e2e.json'],
    {
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
    },
  );

  jestProcess.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E safe FAIL: ${message}`);
  process.exitCode = 1;
});

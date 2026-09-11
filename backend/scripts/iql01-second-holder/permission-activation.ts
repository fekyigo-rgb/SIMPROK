import { Client } from 'pg';
import {
  assertPermanentAppTarget,
  parsePermanentAppUrl,
  sanitizedResult,
} from '../../src/auth/bp-provisioning-02-production-activation';
import {
  applyIql01SecondHolderActivation,
  iql01SecondHolderTargetFromEnvironment,
  planIql01SecondHolderActivation,
} from '../../src/auth/iql01-second-holder-activation';

async function main(): Promise<void> {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--plan', '--apply'].includes(mode[0])) {
    throw new Error('Use exactly one explicit mode: --plan or --apply.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be supplied externally.');
  }
  assertPermanentAppTarget(parsePermanentAppUrl(connectionString));

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result =
      mode[0] === '--plan'
        ? await planIql01SecondHolderActivation(
            client,
            iql01SecondHolderTargetFromEnvironment(process.env),
          )
        : await applyIql01SecondHolderActivation(client, process.env);
    process.stdout.write(`${sanitizedResult(result)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'STOP_UNKNOWN_ERROR'}\n`,
  );
  process.exitCode = 1;
});

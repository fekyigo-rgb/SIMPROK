import { Client } from 'pg';
import {
  applyBp02Activation,
  assertPermanentAppTarget,
  parsePermanentAppUrl,
  planBp02Activation,
  sanitizedResult,
  targetFromEnvironment,
} from '../../src/auth/bp-provisioning-02-production-activation';

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
    const target = targetFromEnvironment(process.env);
    const result =
      mode[0] === '--plan'
        ? await planBp02Activation(client, target)
        : await applyBp02Activation(client, process.env);
    // Never echo passwords. Apply result redacts secrets path filename.
    if (mode[0] === '--apply' && result && typeof result === 'object' && 'secretsWritten' in result) {
      const safe = {
        ...result,
        secretsWritten: String((result as { secretsWritten: string }).secretsWritten).replace(
          /[^\\/]+$/,
          '<redacted.env>',
        ),
      };
      process.stdout.write(`${sanitizedResult(safe)}\n`);
    } else {
      process.stdout.write(`${sanitizedResult(result)}\n`);
    }
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

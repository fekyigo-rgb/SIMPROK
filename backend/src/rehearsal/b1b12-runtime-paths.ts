import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface B1B12RuntimePaths {
  runtimeRoot: string;
  secretsDirectory: string;
  runtimeLogsDirectory: string;
  rehearsalPgDataDirectory: string;
  backendEnvFile: string;
  migratorEnvFile: string;
  rehearsalDatabaseLogFile: string;
}

/**
 * Resolves every host-owned B1B12 runtime path from one portable root.
 *
 * An explicit, nonblank SIMPROK_RUNTIME_ROOT wins. Otherwise the root belongs
 * to the current OS user. This function only derives paths; it never reads,
 * creates or mutates a runtime file.
 */
export function resolveB1B12RuntimePaths(
  params: {
    environment?: Pick<NodeJS.ProcessEnv, 'SIMPROK_RUNTIME_ROOT'>;
    userHome?: string;
  } = {},
): B1B12RuntimePaths {
  const override = (
    params.environment ?? process.env
  ).SIMPROK_RUNTIME_ROOT?.trim();
  if (override && !isAbsolute(override)) {
    throw new Error(
      'STOP_B1B12_RUNTIME_ROOT_NOT_ABSOLUTE: ' +
        'SIMPROK_RUNTIME_ROOT must be an absolute path when provided.',
    );
  }
  const runtimeRoot = resolve(
    override || join(params.userHome ?? homedir(), 'SIMPROK-RUNTIME'),
  );
  const secretsDirectory = join(runtimeRoot, 'secrets');
  const runtimeLogsDirectory = join(runtimeRoot, 'runtime-logs');

  return {
    runtimeRoot,
    secretsDirectory,
    runtimeLogsDirectory,
    rehearsalPgDataDirectory: join(runtimeRoot, 'rehearsal-rm03d1', 'pgdata'),
    backendEnvFile: join(secretsDirectory, 'b1b12.backend.env'),
    migratorEnvFile: join(secretsDirectory, 'b1b12.migrator.env'),
    rehearsalDatabaseLogFile: join(runtimeLogsDirectory, 'rehearsal-55433.log'),
  };
}

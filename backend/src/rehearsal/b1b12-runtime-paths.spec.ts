import { join, resolve } from 'node:path';

import { resolveB1B12RuntimePaths } from './b1b12-runtime-paths';

describe('B1B12 runtime paths', () => {
  it('uses an explicit nonblank SIMPROK_RUNTIME_ROOT override', () => {
    const override = resolve('owner-selected-runtime');
    const paths = resolveB1B12RuntimePaths({
      environment: { SIMPROK_RUNTIME_ROOT: override },
      userHome: resolve('ignored-current-user-home'),
    });

    expect(paths.runtimeRoot).toBe(override);
  });

  it('rejects a relative SIMPROK_RUNTIME_ROOT override', () => {
    expect(() =>
      resolveB1B12RuntimePaths({
        environment: { SIMPROK_RUNTIME_ROOT: 'relative-runtime-root' },
        userHome: resolve('current-user-home'),
      }),
    ).toThrow(
      'STOP_B1B12_RUNTIME_ROOT_NOT_ABSOLUTE: ' +
        'SIMPROK_RUNTIME_ROOT must be an absolute path when provided.',
    );
  });

  it('defaults to SIMPROK-RUNTIME under the current user home', () => {
    const currentUserHome = resolve('current-user-home');
    const paths = resolveB1B12RuntimePaths({
      environment: { SIMPROK_RUNTIME_ROOT: '   ' },
      userHome: currentUserHome,
    });

    expect(paths.runtimeRoot).toBe(join(currentUserHome, 'SIMPROK-RUNTIME'));
  });

  it('constructs every B1B12 runtime path as a child of the resolved root', () => {
    const runtimeRoot = resolve('portable-runtime-root');
    const paths = resolveB1B12RuntimePaths({
      environment: { SIMPROK_RUNTIME_ROOT: runtimeRoot },
    });

    expect(paths).toEqual({
      runtimeRoot,
      secretsDirectory: join(runtimeRoot, 'secrets'),
      runtimeLogsDirectory: join(runtimeRoot, 'runtime-logs'),
      rehearsalPgDataDirectory: join(runtimeRoot, 'rehearsal-rm03d1', 'pgdata'),
      backendEnvFile: join(runtimeRoot, 'secrets', 'b1b12.backend.env'),
      migratorEnvFile: join(runtimeRoot, 'secrets', 'b1b12.migrator.env'),
      rehearsalDatabaseLogFile: join(
        runtimeRoot,
        'runtime-logs',
        'rehearsal-55433.log',
      ),
    });
  });

  it('does not inject a literal Computer-1 user into the default path', () => {
    const paths = resolveB1B12RuntimePaths({
      environment: {},
      userHome: resolve('current-os-user'),
    });

    expect(paths.runtimeRoot.toLowerCase()).not.toContain('asus');
  });
});

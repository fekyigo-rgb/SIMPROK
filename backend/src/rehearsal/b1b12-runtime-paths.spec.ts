import { join, resolve, sep } from 'node:path';

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
    // The supplied home must NOT be derived from where this checkout happens to
    // live. `resolve('current-os-user')` is relative to process.cwd(), so in a
    // checkout under C:\Users\<name> the FIXTURE smuggled the developer's own
    // user name into the value it then asserted was absent — the test failed for
    // a reason that has nothing to do with the function under test, which takes
    // the home as a parameter and hard-codes no user at all.
    const currentOsUserHome = resolve(sep, 'current-os-user-home');

    const paths = resolveB1B12RuntimePaths({
      environment: {},
      userHome: currentOsUserHome,
    });

    expect(paths.runtimeRoot).toBe(join(currentOsUserHome, 'SIMPROK-RUNTIME'));
    expect(paths.runtimeRoot.toLowerCase()).not.toContain('asus');
  });
});
